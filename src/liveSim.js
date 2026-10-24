import { parseTraceEntry } from "./asmValues.js";
import { useState, useEffect, useRef, useCallback } from "react";

// ─────────────────────────────────────────────────────────────────
//  LIVE SIMULATOR CONNECTION
//  Talks to dme_klr/live/bridge.mjs in 944turbo_dme_klr:
//    GET  <url>/events   SSE, one sim output line per event (history first)
//    POST <url>/cmd      sim commands, one per line
//    POST <url>/restart  fresh sim at t=0
//    GET  <url>/asm/dme|klr  disassembly listing
//  SIM: [IGN] / [INJ] lines (per-spark ignition and per-shot injector
//  pulse widths) collect into ign.dme / ign.klr / ign.inj.
//  DME:/KLR: lines are handed to onLogLines in batches, for the
//  incremental log parsers; "SIM: [...]" lines update the debugger state.
//  Nothing here keeps the whole run: per-spark and register history are
//  capped (oldest dropped), so a long session can't exhaust memory.
// ─────────────────────────────────────────────────────────────────

export const DEFAULT_LIVE_URL = 'http://127.0.0.1:8951';
const FLUSH_MS = 150;   // handle queued bridge lines
const LOG_MS = 500;     // hand new log lines to the parsers
const MAX_IGN  = 40000; // [IGN] / [INJ] pulses kept per series (~8 sim minutes at idle)
const MAX_REGS = 12000; // DME [REGS] lines kept (one per snapshot)

// Cap a history list, dropping to 3/4 so it happens only occasionally
const capped = (arr, max) => arr.length > max ? arr.slice(-Math.floor(max * 3 / 4)) : arr;

const EMPTY_SIM = { state: 'connecting', tNs: 0, dmePc: null, klrPc: null, reason: '', rate: null };

function parseKV(s) {
  const out = {};
  for (const m of s.matchAll(/(\w+)=(\S*)/g)) out[m[1]] = m[2];
  return out;
}
const splitHex = s => (s ? s.split(',').filter(Boolean).map(h => parseInt(h, 16)) : []);

export function useLiveSim(url, onLogLines) {
  const [connected, setConnected] = useState(false);
  const [sim, setSim]       = useState(EMPTY_SIM);
  const [inputs, setInputs] = useState({});
  const [bps, setBps]       = useState({ dme: [], klr: [] });
  const [trace, setTrace]   = useState({ dme: [], klr: [] });
  const [traceCtx, setTraceCtx] = useState({ dme: [], klr: [] });   // per trace entry
  const [error, setError]   = useState(null);
  const [asm, setAsm]       = useState({ dme: [], klr: [] });
  const [regs, setRegs]     = useState({ dme: null, klr: null });
  const [dmeRegsHist, setDmeRegsHist] = useState([]);   // every DME [REGS] line, by t_ms
  const [warnings, setWarnings] = useState([]);   // "DME: [WARN] ..." lines, newest last
  const [ign, setIgn]       = useState({ dme: [], klr: [], inj: [] });   // [{t: ms, w: pulse ms}]

  const lines = useRef([]);         // log lines not yet handed to onLogLines
  const reset = useRef(false);      // next hand-off starts the log over
  const dirty = useRef(false);
  const ignRef = useRef({ dme: [], klr: [], inj: [] });
  const ignDirty = useRef(false);
  const onLogRef = useRef(onLogLines);
  useEffect(() => { onLogRef.current = onLogLines; }, [onLogLines]);

  useEffect(() => {
    if (!url) return;
    // The bridge replays its history on connect, so start the log over
    lines.current = []; reset.current = true; dirty.current = true;
    ignRef.current = { dme: [], klr: [], inj: [] };
    const es = new EventSource(`${url}/events`);
    es.onopen = () => { setConnected(true); setError(null); };
    es.onerror = () => { setConnected(false); setError(`Can't reach the simulator bridge at ${url}`); };
    // Lines are queued and handled together on the flush tick, so a burst
    // of bridge messages costs one React render instead of one per line
    // (a render per line kept the page busy enough to freeze it).
    const queue = [];
    let lastLog = 0;
    // Rare control replies (breakpoints, run state, errors) skip the queue
    // so clicks feel immediate; queued lines are handled first to keep order.
    const URGENT = /^SIM: \[(BP|STATE|ERROR|EXIT|RESTART)\]/;
    es.onmessage = ev => {
      if (!URGENT.test(ev.data)) { queue.push(ev.data); return; }
      for (const line of queue.splice(0)) handle(line);
      handle(ev.data);
    };
    const handle = line => {
      if (!line.startsWith('SIM: ')) {
        lines.current.push(line); dirty.current = true;
        if (/^(DME|KLR): \[WARN\]/.test(line)) setWarnings(w => [...w.slice(-49), line]);
        return;
      }
      const tag = line.match(/^SIM: \[(\w+)\]\s*(.*)$/);
      if (!tag) return;
      const [, kind, rest] = tag;
      if (kind === 'IGN' || kind === 'INJ') {
        const cpu = kind === 'INJ' ? 'inj' : rest.split(' ')[0];
        const kv = parseKV(rest);
        const list = ignRef.current[cpu];
        if (list) {
          list.push({ t: +kv.t_ns / 1e6, w: +kv.width_ns / 1e6 });
          if (list.length > MAX_IGN) ignRef.current[cpu] = capped(list, MAX_IGN);
        }
        ignDirty.current = true;
      } else if (kind === 'RESTART') {
        lines.current = []; reset.current = true; dirty.current = true;
        ignRef.current = { dme: [], klr: [], inj: [] }; ignDirty.current = true;
        setWarnings([]);
        setSim(EMPTY_SIM); setTrace({ dme: [], klr: [] }); setTraceCtx({ dme: [], klr: [] }); setError(null); setRegs({ dme: null, klr: null }); setDmeRegsHist([]);
      } else if (kind === 'STATE') {
        const st = rest.split(' ')[0];
        const kv = parseKV(rest);
        setSim(s => ({ ...s, state: st, tNs: +kv.t_ns, dmePc: parseInt(kv.dme_pc, 16),
                       klrPc: parseInt(kv.klr_pc, 16), reason: rest.split('reason=')[1] ?? '' }));
      } else if (kind === 'TIME') {
        const kv = parseKV(rest);
        setSim(s => ({ ...s, tNs: +kv.t_ns, rate: +kv.rate }));
      } else if (kind === 'READY' || kind === 'INPUTS') {
        const kv = {};
        for (const part of rest.trim().split(',')) { const [k, v] = part.split('='); if (k) kv[k] = v === 'auto' ? 'auto' : +v; }
        setInputs(kv);
      } else if (kind === 'BP') {
        const kv = parseKV(rest);
        setBps({ dme: splitHex(kv.dme), klr: splitHex(kv.klr) });
      } else if (kind === 'TRACE') {
        const [cpu, list] = rest.split(' ');
        // Entries are pc/ctx0/ctx1/ctx2 (register context per instruction)
        const steps = (list ?? '').split(',').filter(Boolean).map(parseTraceEntry);
        setTrace(t => ({ ...t, [cpu]: steps.map(st => st.pc) }));
        setTraceCtx(t => ({ ...t, [cpu]: steps.map(st => st.ctx) }));
      } else if (kind === 'REGS') {
        const cpu = rest.split(' ')[0];
        if (cpu === 'dmestk') {
          // What wrote each DME stack byte 64h..79h (see the testbench)
          const stk = parseKV(rest).stk?.split('.') ?? null;
          setRegs(g => ({ ...g, dme: g.dme ? { ...g.dme, stk } : g.dme }));
          return;
        }
        const r = {};
        for (const [k, v] of Object.entries(parseKV(rest))) r[k] = k === 't_ms' ? +v : parseInt(v, 16);
        setRegs(g => ({ ...g, [cpu]: r }));
        if (cpu === 'dme') setDmeRegsHist(h => capped([...h, r], MAX_REGS));
      } else if (kind === 'ERROR') {
        setError(rest);
      } else if (kind === 'EXIT') {
        setSim(s => ({ ...s, state: 'exited', reason: rest }));
      }
    };
    // Adaptive pacing: after each update, wait ~3x what it cost (handling
    // plus React's render) so the page stays responsive on slow machines.
    let nextAt = 0;
    const flush = setInterval(() => {
      const t0 = performance.now();
      if (t0 < nextAt) return;
      setTimeout(() => { nextAt = performance.now() + 3 * (performance.now() - t0); }, 0);
      if (queue.length) for (const line of queue.splice(0)) handle(line);
      // Parsing and the re-render it causes are the costly part, so less often.
      // Pulses go out with the log lines, so both land in one render.
      if (!(dirty.current || ignDirty.current) || Date.now() - lastLog < LOG_MS) return;
      lastLog = Date.now();
      if (ignDirty.current) {
        ignDirty.current = false;
        setIgn({ dme: [...ignRef.current.dme], klr: [...ignRef.current.klr], inj: [...ignRef.current.inj] });
      }
      if (!dirty.current) return;
      dirty.current = false;
      const batch = lines.current, fresh = reset.current;
      lines.current = []; reset.current = false;
      onLogRef.current?.(batch, fresh);
    }, FLUSH_MS);

    Promise.all(['dme', 'klr'].map(c => fetch(`${url}/asm/${c}`).then(r => r.ok ? r.json() : []).catch(() => [])))
      .then(([dme, klr]) => setAsm({ dme, klr }));

    return () => { es.close(); clearInterval(flush); setConnected(false); };
  }, [url]);

  const send = useCallback(cmd => {
    if (!url) return;
    fetch(`${url}/cmd`, { method: 'POST', body: cmd })
      .then(r => { if (!r.ok) setError(`Simulator rejected "${cmd}" (HTTP ${r.status})`); })
      .catch(() => setError(`Can't reach the simulator bridge at ${url}`));
  }, [url]);

  const restart = useCallback(() => {
    if (url) fetch(`${url}/restart`, { method: 'POST' }).catch(() => setError(`Can't reach the simulator bridge at ${url}`));
  }, [url]);

  return { connected, sim, inputs, bps, trace, error, asm, regs, dmeRegsHist, traceCtx, ign, warnings, send, restart };
}
