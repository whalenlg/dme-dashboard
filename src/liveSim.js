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
//  DME:/KLR: lines are collected into a log text that the existing
//  parseLog/parseKLRLog read; "SIM: [...]" lines update the debugger state.
// ─────────────────────────────────────────────────────────────────

export const DEFAULT_LIVE_URL = 'http://127.0.0.1:8951';
const FLUSH_MS = 400;

const EMPTY_SIM = { state: 'connecting', tNs: 0, dmePc: null, klrPc: null, reason: '', rate: null };

function parseKV(s) {
  const out = {};
  for (const m of s.matchAll(/(\w+)=(\S*)/g)) out[m[1]] = m[2];
  return out;
}
const splitHex = s => (s ? s.split(',').filter(Boolean).map(h => parseInt(h, 16)) : []);

export function useLiveSim(url, onLogText) {
  const [connected, setConnected] = useState(false);
  const [sim, setSim]       = useState(EMPTY_SIM);
  const [inputs, setInputs] = useState({});
  const [bps, setBps]       = useState({ dme: [], klr: [] });
  const [trace, setTrace]   = useState({ dme: [], klr: [] });
  const [error, setError]   = useState(null);
  const [asm, setAsm]       = useState({ dme: [], klr: [] });
  const [warnings, setWarnings] = useState([]);   // "DME: [WARN] ..." lines, newest last
  const [ign, setIgn]       = useState({ dme: [], klr: [], inj: [] });   // [{t: ms, w: pulse ms}]

  const lines = useRef([]);
  const dirty = useRef(false);
  const ignRef = useRef({ dme: [], klr: [], inj: [] });
  const ignDirty = useRef(false);
  const onLogRef = useRef(onLogText);
  useEffect(() => { onLogRef.current = onLogText; }, [onLogText]);

  useEffect(() => {
    if (!url) return;
    lines.current = [];
    ignRef.current = { dme: [], klr: [], inj: [] };
    const es = new EventSource(`${url}/events`);
    es.onopen = () => { setConnected(true); setError(null); };
    es.onerror = () => { setConnected(false); setError(`Can't reach the simulator bridge at ${url}`); };
    es.onmessage = ev => {
      const line = ev.data;
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
        ignRef.current[cpu]?.push({ t: +kv.t_ns / 1e6, w: +kv.width_ns / 1e6 });
        ignDirty.current = true;
      } else if (kind === 'RESTART') {
        lines.current = []; dirty.current = true;
        ignRef.current = { dme: [], klr: [], inj: [] }; ignDirty.current = true;
        setWarnings([]);
        setSim(EMPTY_SIM); setTrace({ dme: [], klr: [] }); setError(null);
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
        setTrace(t => ({ ...t, [cpu]: splitHex(list) }));
      } else if (kind === 'ERROR') {
        setError(rest);
      } else if (kind === 'EXIT') {
        setSim(s => ({ ...s, state: 'exited', reason: rest }));
      }
    };
    const flush = setInterval(() => {
      if (ignDirty.current) {
        ignDirty.current = false;
        setIgn({ dme: [...ignRef.current.dme], klr: [...ignRef.current.klr], inj: [...ignRef.current.inj] });
      }
      if (!dirty.current) return;
      dirty.current = false;
      onLogRef.current?.(lines.current.join('\n'));
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

  return { connected, sim, inputs, bps, trace, error, asm, ign, warnings, send, restart };
}
