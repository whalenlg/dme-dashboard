import { parseTraceEntry } from "./asmValues.js";
import { useState, useEffect, useRef, useCallback } from "react";

// ─────────────────────────────────────────────────────────────────
//  LIVE SIMULATOR CONNECTION
//  Talks to dme_klr/live/bridge.mjs in 944turbo_dme_klr:
//    GET  <url>/events   SSE, one sim output line per event (history first)
//    POST <url>/cmd      sim commands, one per line
//    POST <url>/restart  fresh sim at t=0
//    POST <url>/rom?cpu=dme|klr&name=<x.mem>[&reset=1]  load a ROM image
//                        (body = the .mem text; only while paused)
//    POST <url>/patch?cpu=dme|klr  {addr, bytes} or {revert: true}: edit bytes
//                        of the loaded image in place (only while paused)
//    GET  <url>/asm/dme|klr  disassembly listing; fetched again on
//                        SIM: [ASM] dme|klr <workbook> match=content|name|none [patched=<n> [saved=<x.mem>]],
//                        which the bridge sends when that CPU's image changes
//                        (edited rows carry patched and orig: the bytes as loaded)
//                        (saved: the edits were kept as that image with SAVE AS)
//    GET  <url>/snapshots, /snapshots/<id>[/bundle], POST /snapshots/<id>/load,
//    POST /snapshots/upload, DELETE /snapshots/<id>: snapshots of the whole
//                        model, saved by the sim on each warning (or "save");
//                        the list is fetched again on SIM: [SNAP] ready|deleted
//  SIM: [WATCH] / [WRITES] / [WRITERS]: watchpoints and the sim's write log
//                        (who changed each RAM byte, from reset), see parseWrites
//  SIM: [PROF]: the routine profile (calls, min / avg / max time per routine
//                        and interrupt), see parseProf
//  SIM: [IGN] / [INJ] lines (per-spark ignition and per-shot injector
//  pulse widths) collect into ign.dme / ign.klr / ign.inj.
//  DME:/KLR: lines are handed to onLogLines in batches, for the
//  incremental log parsers; "SIM: [...]" lines update the debugger state.
//  Nothing here keeps the whole run: per-spark and register history are
//  capped (oldest dropped), so a long session can't exhaust memory.
// ─────────────────────────────────────────────────────────────────

// The bridge's address. The lite package's copy of the dashboard (built
// with --mode lite) is served by the bridge itself, so it uses the page's
// own origin, whatever --port the bridge was given.
export const DEFAULT_LIVE_URL = import.meta.env.VITE_LIVE_SAME_ORIGIN
  ? window.location.origin
  : 'http://127.0.0.1:8951';
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
// Breakpoint conditions in a [BP] list: 024E@37==15, 0ABC@21.0!=1
// → { 0x24E: {mem:0x37, bit:null, op:'==', val:0x15}, ... }
const BP_COND = /^([0-9A-Fa-f]+)@([0-9A-Fa-f]{1,2})(?:\.([0-7]))?(==|!=|<|>)([0-9A-Fa-f]{1,2})$/;
const splitConds = s => {
  const out = {};
  for (const t of (s ?? '').split(',')) {
    const m = BP_COND.exec(t);
    if (m) out[parseInt(m[1], 16)] = { mem: parseInt(m[2], 16), bit: m[3] != null ? +m[3] : null, op: m[4], val: parseInt(m[5], 16) };
  }
  return out;
};

// A write-log change, "<pc>/<t_ns>/<old><new>[/i]" (bits: "1A2B/812345/01")
// → {pc, t: ms, old, nw, irq}; "-" → null
const parseChg = (s, bit) => {
  const m = /^([0-9A-F]+)\/(\d+)\/([0-9A-F]+)(\/i)?$/i.exec(s ?? '');
  if (!m) return null;
  const v = m[3], h = v.length / 2;
  return { pc: parseInt(m[1], 16), t: +m[2] / 1e6, old: parseInt(v.slice(0, h), bit ? 2 : 16),
           nw: parseInt(v.slice(h), bit ? 2 : 16), irq: !!m[4] };
};
// SIM: [WRITES] dme 21.3 n=4 since=0 first=<c> [set=<c> clr=<c>] hist=<c>;<c>
export function parseWrites(rest) {
  const m = /^(dme|klr) ([0-9A-F]{2})(?:\.([0-7]))?\s+(.*)$/i.exec(rest);
  if (!m) return null;
  const kv = parseKV(m[4]), bit = m[3] != null;
  return { cpu: m[1], key: m[2].toUpperCase() + (bit ? `.${m[3]}` : ''), mem: parseInt(m[2], 16), bit: bit ? +m[3] : null,
           n: +kv.n, since: +kv.since / 1e6, first: parseChg(kv.first, bit), set: parseChg(kv.set, bit), clr: parseChg(kv.clr, bit),
           hist: (kv.hist ?? '').split(';').map(c => parseChg(c, bit)).filter(Boolean) };
}
// SIM: [WRITERS] dme since=0 37=1A2B/12/0F00/800000/99000000,...
function parseWriters(rest) {
  const m = /^(dme|klr) since=(\d+)\s*(.*)$/.exec(rest);
  if (!m) return null;
  const rows = [];
  for (const t of m[3].split(',').filter(Boolean)) {
    const r = /^([0-9A-F]{2})=([0-9A-F]+)\/(\d+)\/([0-9A-F]+)\/(\d+)\/(\d+)$/i.exec(t);
    if (r) rows.push({ mem: parseInt(r[1], 16), last: parseInt(r[2], 16), n: +r[3], first: parseInt(r[4], 16), firstT: +r[5] / 1e6, lastT: +r[6] / 1e6 });
  }
  return { cpu: m[1], since: +m[2] / 1e6, rows };
}
// A [WATCH] list, "37,21.3:log" → [{key:'37', mem, bit, brk}]
const splitWatches = s => (s ?? '').split(',').filter(Boolean).map(t => {
  const m = /^([0-9A-F]{2})(?:\.([0-7]))?(:log)?$/i.exec(t);
  return m && { key: m[1].toUpperCase() + (m[2] != null ? `.${m[2]}` : ''), mem: parseInt(m[1], 16), bit: m[2] != null ? +m[2] : null, brk: !m[3] };
}).filter(Boolean);

// SIM: [PROF] dme t_ns=<n> since=<n> depth=<n> maxdepth=<n> unmatched=<n> dropped=<n>
//   r=<c|i><entry>/<calls>/<min>/<sum>/<max>/<xmin>/<xsum>/<xmax>/<cmin>/<csum>/<cmax>;...
// (the routine profile, sim_main's prof.h: times in ns, x = less the
// interrupts taken inside, c = machine cycles)
// → {cpu, tNs, since, depth, maxDepth, unmatched, dropped, rows: [{irq, a, n, t: {min, avg, max, sum}, x: {...}, c: {...}}]}
export function parseProf(rest) {
  const m = /^(dme|klr) (.*?)\s*r=(\S*)$/.exec(rest);
  if (!m) return null;
  const kv = parseKV(m[2]);
  const rows = [];
  for (const e of m[3].split(';')) {
    const r = /^([ci])([0-9A-F]+)\/(.*)$/i.exec(e);
    if (!r) continue;
    const v = r[3].split('/').map(Number);
    if (v.length < 10 || !(v[0] > 0)) continue;
    const st = (min, sum, max) => ({ min, sum, max, avg: sum / v[0] });
    rows.push({ irq: r[1] === 'i', a: parseInt(r[2], 16), n: v[0],
                t: st(v[1], v[2], v[3]), x: st(v[4], v[5], v[6]), c: st(v[7], v[8], v[9]) });
  }
  return { cpu: m[1], tNs: +kv.t_ns, since: +kv.since, depth: +kv.depth, maxDepth: +kv.maxdepth,
           unmatched: +kv.unmatched, dropped: +kv.dropped, rows };
}

export function useLiveSim(url, onLogLines) {
  const [connected, setConnected] = useState(false);
  const [sim, setSim]       = useState(EMPTY_SIM);
  const [inputs, setInputs] = useState({});
  const [bps, setBps]       = useState({ dme: [], klr: [] });
  const [bpConds, setBpConds] = useState({ dme: {}, klr: {} });   // pc → memory condition, see splitConds
  const [trace, setTrace]   = useState({ dme: [], klr: [] });
  const [traceCtx, setTraceCtx] = useState({ dme: [], klr: [] });   // per trace entry
  const [error, setError]   = useState(null);
  const [asm, setAsm]       = useState({ dme: [], klr: [] });
  const [regs, setRegs]     = useState({ dme: null, klr: null });
  const [dmeRegsHist, setDmeRegsHist] = useState([]);   // every DME [REGS] line, by t_ms
  // SIM: [HISTORY] full: the bridge's history reached its limit and it paused
  // the sim ({lines, trimmed}); cleared when the sim runs again or restarts
  const [historyFull, setHistoryFull] = useState(null);
  // CAPTURE LOG pressed at t=0 arms it (the bridge saves it on the next
  // pause): the armed name, and the last capture's result ({ok, ...} as
  // capture() gives), from SIM: [CAPTURE] lines
  const [captureArmed, setCaptureArmed] = useState(null);
  const [captureResult, setCaptureResult] = useState(null);
  const [warnings, setWarnings] = useState([]);   // "DME: [WARN] ..." lines, newest last
  const [ign, setIgn]       = useState({ dme: [], klr: [], inj: [] });   // [{t: ms, w: pulse ms}]
  const [roms, setRoms]     = useState({ dme: null, klr: null });   // path of the image in each EPROM
  const [asmSrc, setAsmSrc] = useState({ dme: null, klr: null });   // {workbook, match, patched: bytes edited, saved: kept as} each listing came from
  const [snapshots, setSnapshots] = useState([]);   // bridge's list, newest first
  const [snapCfg, setSnapCfg] = useState({ auto: true, brk: false, taken: 0, max: 25 });
  const [interval, setIntervalMs] = useState(null);   // {ms, def}: DS snapshot interval, from SIM: [INTERVAL] (null: the sim doesn't report one)
  const [loadedSnap, setLoadedSnap] = useState(null);   // id of the snapshot this run started from
  const [snapBusy, setSnapBusy] = useState(null);       // a regression test being built for LOAD: its latest progress line
  const [setupsVer, setSetupsVer] = useState(0);
  // Watchpoints and the write log: null until the sim reports [WATCH]
  // (a build from before them doesn't)
  const [watches, setWatches] = useState(null);         // {dme: [{key, mem, bit, brk}], klr}
  const [writes, setWrites]   = useState({ dme: {}, klr: {} });   // key ('37', '21.3') → parseWrites
  const [writers, setWriters] = useState({ dme: null, klr: null }); // parseWriters
  // The routine profile, from SIM: [PROF] (null: none yet, or a sim from before it)
  const [prof, setProf] = useState({ dme: null, klr: null });   // parseProf   // bumped on SIM: [SETUPS] (GET <url>/setups)

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
    const URGENT = /^SIM: \[(BP|STATE|ERROR|EXIT|RESTART|ROM|ASM|SNAP|SNAPCFG|INTERVAL|SETUPS|WATCH|WRITES|WRITERS)\]/;
    const fetchSnaps = () => fetch(`${url}/snapshots`).then(r => r.ok ? r.json() : null).catch(() => null)
      .then(list => { if (list) setSnapshots(list); });
    es.onmessage = ev => {
      if (!URGENT.test(ev.data)) {
        queue.push(ev.data);
        // Also tick from here: with the tabs and code debuggers in windows of
        // their own, this page may be covered, and a hidden page's timers
        // are slowed to once a second (or once a minute) by the browser
        if (performance.now() - lastTick > 4 * FLUSH_MS) tick();
        return;
      }
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
        setLoadedSnap(null);
        lines.current = []; reset.current = true; dirty.current = true;
        ignRef.current = { dme: [], klr: [], inj: [] }; ignDirty.current = true;
        setWarnings([]);
        setHistoryFull(null);
        // The new sim starts with none of its own: its [BP] line (the bridge
        // adds the old ones again) says which are set, so the code windows
        // never list a breakpoint the sim doesn't have
        setBps({ dme: [], klr: [] }); setBpConds({ dme: {}, klr: {} });
        setWatches(null); setWrites({ dme: {}, klr: {} }); setWriters({ dme: null, klr: null });
        setProf({ dme: null, klr: null });
        setSim(EMPTY_SIM); setTrace({ dme: [], klr: [] }); setTraceCtx({ dme: [], klr: [] }); setError(null); setRegs({ dme: null, klr: null }); setDmeRegsHist([]);
      } else if (kind === 'CAPTURE') {
        if (rest.startsWith('armed')) setCaptureArmed(parseKV(rest).name ?? '');
        else if (rest.startsWith('disarmed')) setCaptureArmed(null);
        else if (rest.startsWith('result ')) {
          setCaptureArmed(null);
          try { setCaptureResult(JSON.parse(rest.slice(7))); } catch { /* not JSON */ }
        }
      } else if (kind === 'HISTORY') {
        const kv = parseKV(rest);
        if (rest.startsWith('full')) setHistoryFull({ lines: +kv.lines, trimmed: kv.trimmed === '1' });
      } else if (kind === 'STATE') {
        const st = rest.split(' ')[0];
        if (st === 'running') setHistoryFull(null);
        const kv = parseKV(rest);
        setSim(s => ({ ...s, state: st, tNs: +kv.t_ns, dmePc: parseInt(kv.dme_pc, 16),
                       klrPc: parseInt(kv.klr_pc, 16), reason: rest.split('reason=')[1] ?? '' }));
      } else if (kind === 'TIME') {
        const kv = parseKV(rest);
        setSim(s => ({ ...s, tNs: +kv.t_ns, rate: +kv.rate }));
      } else if (kind === 'READY' || kind === 'INPUTS') {
        const kv = {};
        for (const part of rest.trim().split(',')) { const [k, v] = part.split('='); if (k) kv[k] = v === 'auto' || v === 'script' ? v : +v; }
        setInputs(kv);
      } else if (kind === 'BP') {
        const kv = parseKV(rest);
        setBps({ dme: splitHex(kv.dme), klr: splitHex(kv.klr) });
        setBpConds({ dme: splitConds(kv.dme), klr: splitConds(kv.klr) });
      } else if (kind === 'WATCH') {
        const kv = parseKV(rest);
        setWatches({ dme: splitWatches(kv.dme), klr: splitWatches(kv.klr) });
      } else if (kind === 'WRITES') {
        const w = parseWrites(rest);
        if (w) setWrites(x => ({ ...x, [w.cpu]: { ...x[w.cpu], [w.key]: w } }));
      } else if (kind === 'WRITERS') {
        const w = parseWriters(rest);
        if (w) setWriters(x => ({ ...x, [w.cpu]: w }));
      } else if (kind === 'PROF') {
        const p = parseProf(rest);
        if (p) setProf(x => ({ ...x, [p.cpu]: p }));
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
      } else if (kind === 'ROM') {
        const [, cpu, path] = rest.match(/^(dme|klr) (.*)$/) ?? [];
        if (cpu) setRoms(r => ({ ...r, [cpu]: path }));
      } else if (kind === 'ASM') {
        // The bridge switched the listing to the new image's workbook
        const [cpu, workbook] = rest.split(' ');
        const kv = parseKV(rest);
        if (cpu !== 'dme' && cpu !== 'klr') return;
        setAsmSrc(s => ({ ...s, [cpu]: { workbook, match: kv.match ?? '', patched: +(kv.patched ?? 0), saved: kv.saved ?? null } }));
        fetch(`${url}/asm/${cpu}`).then(r => r.ok ? r.json() : null).catch(() => null)
          .then(rows => { if (rows) setAsm(a => ({ ...a, [cpu]: rows })); });
      } else if (kind === 'SNAP') {
        // saved (sim) -> ready (bridge, files complete); loaded; deleted
        const what = rest.split(' ')[0];
        if (what === 'ready' || what === 'deleted') fetchSnaps();
        if (what === 'building') {
          const msg = rest.replace(/^building id=\S+\s*/, '');
          setSnapBusy(/ (done|failed)$/.test(msg) ? null : msg);
        }
        // A snapshot load starts the write log again at its time
        if (what === 'loaded') { setWrites({ dme: {}, klr: {} }); setWriters({ dme: null, klr: null }); }
        if (what === 'loaded') setLoadedSnap(rest.match(/dir=(.*)$/)?.[1]?.split(/[\\/]/).filter(Boolean).pop() ?? null);
      } else if (kind === 'SETUPS') {
        setSetupsVer(v => v + 1);   // the image setups changed: lists fetch them again
      } else if (kind === 'SNAPCFG') {
        const kv = parseKV(rest);
        setSnapCfg({ auto: kv.auto === 'on', brk: kv.break === 'on', taken: +kv.taken, max: +kv.max });
      } else if (kind === 'INTERVAL') {
        const kv = parseKV(rest);
        setIntervalMs({ ms: +kv.ms, def: +kv.default });
      } else if (kind === 'ERROR') {
        setError(rest);
      } else if (kind === 'EXIT') {
        setSim(s => ({ ...s, state: 'exited', reason: rest }));
      }
    };
    // Adaptive pacing: after each update, wait ~3x what it cost (handling
    // plus React's render) so the page stays responsive on slow machines.
    let nextAt = 0, lastTick = 0;
    const tick = () => {
      const t0 = performance.now();
      if (t0 < nextAt) return;
      lastTick = t0;
      // (capped: a hidden page's setTimeout runs late, which isn't work done)
      setTimeout(() => { nextAt = performance.now() + Math.min(1000, 3 * (performance.now() - t0)); }, 0);
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
    };
    const flush = setInterval(tick, FLUSH_MS);

    Promise.all(['dme', 'klr'].map(c => fetch(`${url}/asm/${c}`).then(r => r.ok ? r.json() : []).catch(() => [])))
      .then(([dme, klr]) => setAsm({ dme, klr }));
    fetchSnaps();

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

  // CAPTURE LOG: the run so far saved by the bridge as a regression-format
  // .dash.log (POST /capture, only while not running), with its basic checks:
  // {ok: true, ...the bridge's answer} or {ok: false, error}
  const capture = useCallback(async name => {
    if (!url) return { ok: false, error: 'not connected' };
    try {
      const r = await fetch(`${url}/capture`, { method: 'POST', body: JSON.stringify(name ? { name } : {}) });
      if (r.status === 404) return { ok: false, error: 'this bridge has no CAPTURE LOG: update 944turbo_dme_klr and restart the bridge' };
      if (!r.ok) return { ok: false, error: (await r.text()) || `HTTP ${r.status}` };
      return { ok: true, ...(await r.json()) };
    } catch {
      return { ok: false, error: `Can't reach the simulator bridge at ${url}` };
    }
  }, [url]);

  const disarmCapture = useCallback(() => {
    if (url) fetch(`${url}/capture`, { method: 'DELETE' }).catch(() => setError(`Can't reach the simulator bridge at ${url}`));
  }, [url]);

  // Load a ROM image into the DME or KLR EPROM; reset restarts the sim on it.
  // A raw .bin or Intel HEX image is sent as its bytes: the bridge saves it
  // as the .mem the sim loads
  const loadRom = useCallback(async (cpu, file, reset) => {
    if (!url || !file) return;
    if (!/\.(mem|bin|hex|ihx)$/i.test(file.name)) { setError(`${file.name}: ROM images must be .mem, .bin or Intel HEX (.hex) files`); return; }
    try {
      const q = new URLSearchParams({ cpu, name: file.name, ...(reset ? { reset: '1' } : {}) });
      const r = await fetch(`${url}/rom?${q}`, { method: 'POST', body: await file.arrayBuffer() });
      if (!r.ok) setError(`Couldn't load ${file.name}: ${(await r.text()) || `HTTP ${r.status}`}`);
      else setError(null);
    } catch {
      setError(`Can't reach the simulator bridge at ${url}`);
    }
  }, [url]);

  // Edit bytes of the image in a CPU's EPROM (the code windows' hex column):
  // applied live by the bridge, which then sends the listing again
  const patchCall = useCallback(async (cpu, body, what) => {
    if (!url) return false;
    try {
      const r = await fetch(`${url}/patch?cpu=${cpu}`, { method: 'POST', body: JSON.stringify(body) });
      if (!r.ok) { setError(`${what}: ${(await r.text()) || `HTTP ${r.status}`}`); return false; }
      setError(null);
      return true;
    } catch {
      setError(`Can't reach the simulator bridge at ${url}`);
      return false;
    }
  }, [url]);
  const patchRom = useCallback((cpu, addr, bytes) =>
    patchCall(cpu, { addr, bytes }, `Couldn't edit the ${cpu.toUpperCase()} ROM at ${addr.toString(16).toUpperCase()}h`), [patchCall]);
  const revertRom = useCallback(cpu => patchCall(cpu, { revert: true }, `Couldn't revert the ${cpu.toUpperCase()} ROM edits`), [patchCall]);

  // ── Snapshots ──
  const snapCall = useCallback(async (path, opts, what) => {
    if (!url) return null;
    try {
      const r = await fetch(`${url}${path}`, opts);
      if (!r.ok) { setError(`${what}: ${(await r.text()) || `HTTP ${r.status}`}`); return null; }
      return r;
    } catch {
      setError(`Can't reach the simulator bridge at ${url}`);
      return null;
    }
  }, [url]);
  const snapUrl = id => `/snapshots/${encodeURIComponent(id)}`;
  const loadSnapshot = useCallback(id => snapCall(`${snapUrl(id)}/load`, { method: 'POST' }, `Couldn't load snapshot ${id}`), [snapCall]);
  // A regression test run to a chosen time (the bridge's test_snap.py add)
  const addTestSnapshot = useCallback(async (test, ms, label) => {
    const r = await snapCall('/snapshots/test', { method: 'POST', body: JSON.stringify({ test, ms, label }) }, `Couldn't add ${test} at ${ms} ms`);
    if (r) setError(null);
    return !!r;
  }, [snapCall]);
  const deleteSnapshot = useCallback(id => snapCall(snapUrl(id), { method: 'DELETE' }, `Couldn't delete snapshot ${id}`), [snapCall]);
  // Several at once (CLEAR TESTS): one DELETE each, in turn; the count that went
  const deleteSnapshots = useCallback(async ids => {
    let n = 0;
    for (const id of ids) if (await snapCall(snapUrl(id), { method: 'DELETE' }, `Couldn't delete snapshot ${id}`)) n++;
    return n;
  }, [snapCall]);
  const snapshotDetail = useCallback(async id => {
    const r = await snapCall(snapUrl(id), {}, `Couldn't read snapshot ${id}`);
    return r ? r.json() : null;
  }, [snapCall]);
  // Save the one-file bundle (.dmesnap) through the browser
  const downloadSnapshot = useCallback(async id => {
    const r = await snapCall(`${snapUrl(id)}/bundle`, {}, `Couldn't download snapshot ${id}`);
    if (!r) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await r.blob());
    a.download = `${id}.dmesnap`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, [snapCall]);
  const uploadSnapshot = useCallback(async file => {
    if (!file) return;
    const r = await snapCall('/snapshots/upload', { method: 'POST', body: file }, `Couldn't upload ${file.name}`);
    if (r) setError(null);
  }, [snapCall]);

  return { connected, sim, inputs, bps, bpConds, watches, writes, writers, prof, trace, error, asm, asmSrc, regs, dmeRegsHist, traceCtx, ign, warnings, historyFull, captureArmed, captureResult, disarmCapture, roms, send, restart, capture, loadRom, patchRom, revertRom, setupsVer,
           snapshots, snapCfg, interval, loadedSnap, snapBusy, loadSnapshot, addTestSnapshot, deleteSnapshot, deleteSnapshots, downloadSnapshot, uploadSnapshot, snapshotDetail };
}
