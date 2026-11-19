import { useState, useMemo } from "react";
import RegressHosts from "./RegressHosts.jsx";
import HostTest from "./HostTest.jsx";
import RomVariants from "./RomVariants.jsx";
import { useRegressHosts, usableThreads, romFolder } from "./runAll.js";

// ─────────────────────────────────────────────────────────────────
//  RUN REGRESSIONS: the regression suite from the dashboard
//  Talks to dme_klr/live/runall.mjs on the bridge (944turbo_dme_klr):
//    GET  <url>/runall        the tests in the manuals' Appendix A groups,
//                             with their simulated lengths, and the run
//    POST <url>/runall/start  JSON options (below)
//    POST <url>/runall/stop
//    POST <url>/runall/threads  {host: 'local' | <host id>, threads}: while a
//                             run goes, tests at a time here or on a host
//    POST <url>/runall/cancel   {sim, rom, tests}: queued tests never start
//                             (running ones end as they would have)
//    GET  <url>/runall/fqs?rom=<folder>  the FQS analysis (fqs_analysis.py)
//                             of one ROM pair's dash logs as they are now
//                             (developer install)
//    GET  <url>/runall/romdiff?roms=a,b  ROM VARIANTS: two or more ROM
//                             pairs' tests side by side (RomVariants.jsx)
//  Each ROM pair's runs write in its own folder, $DMEKLR_TMP/dme_klr/<rom>
//  (89, 86, carpokes or the DME image's name: romFolder in runAll.js).
//  Developer install: the named pairs can be ticked together (89 alone by
//  default), {pairs: ['89', '86', 'carpokes']}: each test then runs once per
//  pair and simulator (run_all.sh --roms), each pair in its own folder, and
//  the run's suites are 'vl:<rom>' / 'iv:<rom>'.
//  Developer install: dme_klr/run_all.sh with every option it takes.
//  Lite package: run_tests.py (Verilator only, so iverilog and the
//  run_all-only options are greyed out).
//  Progress is simulated time against each test's length; the run keeps
//  going on the bridge when this panel is closed.
// ─────────────────────────────────────────────────────────────────

const C = {
  bg:'#040a04', panelBg:'#060e06', panelBg2:'#0a150a', border:'#0d2e0d', border2:'#1a3a1a',
  text:'#00e060', textDim:'#ccddcc', textBright:'#00ff80', amber:'#ffaa00', red:'#ff4444', blue:'#44aaff', grey:'#557755',
};
const VERDICT_COL = { PASS:C.textBright, WARN:C.amber, FAIL:C.red, SKIP:C.grey };
// The manuals' rate: about 40 s of wall time per simulated second, per test
const WALL_PER_SIM_S = 40;
// The manuals, kept with the simulator; a group's MANUAL button opens its
// section of Appendix A (the bridge names the manual and the anchor)
const DOCS_URL = 'https://github.com/whalenlg/944turbo_dme_klr/blob/main';

const fmtDur = s => {
  if (s == null || !isFinite(s)) return '—';
  s = Math.max(0, Math.round(s));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(s / 3600)} h ${String(Math.floor(s % 3600 / 60)).padStart(2, '0')} min`;
};
const fmtSim = s => (s >= 60 && s % 60 === 0 ? `${s / 60} min` : `${+s.toFixed(1)} s`);
const pctOf = (d, t) => (t > 0 ? Math.min(100, (100 * d) / t) : 0);
// iv_disk_rates.json is in MiB (du); shown in decimal MB / GB, as Finder and Explorer show file sizes
const fmtSize = mb => {
  if (mb == null) return '—';
  const b = mb * 1048576;
  return b >= 1e9 ? `${(b / 1e9).toFixed(b >= 1e11 ? 0 : 1)} GB` : `${Math.round(b / 1e6)} MB`;
};

// The longest-first schedule run_tests.py and run_dashboard_parallel.sh
// use, as wall seconds at the manuals' rate: a run can't end before its
// longest test, and N workers share the rest
function estimateWall(lens, workers) {
  const w = Array(Math.max(1, workers)).fill(0);
  for (const l of [...lens].sort((a, b) => b - a)) {
    let i = 0;
    for (let k = 1; k < w.length; k++) if (w[k] < w[i]) i = k;
    w[i] += l * WALL_PER_SIM_S;
  }
  return Math.max(...w);
}

function Bar({ pct, color = C.textBright, height = 8, label, title }) {
  return (
    <div title={title} style={{position:'relative',height,background:'#020602',border:`1px solid ${C.border2}`,
                               borderRadius:'2px',overflow:'hidden',flex:1,minWidth:'60px'}}>
      <div style={{width:`${pct}%`,height:'100%',background:color,opacity:.75,transition:'width .4s'}} />
      {label != null && <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',
                                     fontSize:'10px',color:'#e8ffe8',textShadow:'0 0 3px #000,0 0 3px #000'}}>{label}</div>}
    </div>
  );
}

export default function RunAllPanel({ url, state, onClose }) {
  const { info, err, refresh } = state;
  const mode = info?.mode;
  const lite = mode === 'lite';
  const run = info?.run;
  const groups = useMemo(() => info?.groups ?? [], [info?.groups]);
  const allTests = useMemo(() => groups.flatMap(g => g.tests), [groups]);
  const lenOf = useMemo(() => Object.fromEntries(allTests.map(t => [t.name, t.sim_s])), [allTests]);

  // ── Options ───────────────────────────────────────────────
  const [sel, setSel] = useState(null);             // Set of picked tests; null = all
  const picked = useMemo(() => sel ?? new Set(allTests.map(t => t.name)), [sel, allTests]);
  const [vl, setVl] = useState(true);
  const [iv, setIv] = useState(true);
  const [workers, setWorkers] = useState(null);
  const [perTest, setPerTest] = useState(false);
  const [debug, setDebug] = useState({});             // test → iverilog debug flags (step 4)
  const [itests, setItests] = useState(() => new Set());   // step 6's install tests: none by default
  const [pull, setPull] = useState(true);
  const [plot, setPlot] = useState(true);             // step 5's difference plots (off: --no-plot)
  const [interval, setIntervalMs] = useState(100);
  const [simMs, setSimMs] = useState('');
  // The ROM images every test runs on (the bridge's list; 1989 by default)
  const romInfo = info?.roms;
  const [rom, setRom] = useState(null);              // {dme, klr}: a custom pair; null = the ticked pair(s)
  const [pairs, setPairs] = useState(() => new Set(['89']));   // the named pairs ticked (developer install)
  const [open, setOpen] = useState({});              // group name → expanded
  const [showOut, setShowOut] = useState(false);
  const [fqs, setFqs] = useState(null);              // null = closed; {loading} | {text, at, ...} | {error}
  const [fqsRom, setFqsRom] = useState(null);        // the FQS analysis' ROM folder; null = the picked pair's
  const [variants, setVariants] = useState(false);    // the ROM VARIANTS view is open
  const [busy, setBusy] = useState(null);
  const hostState = useRegressHosts(url, true);
  const [useHosts, setUseHosts] = useState(true);
  const remoteW = useHosts ? usableThreads(hostState.hosts) : 0;
  const ivOn = iv && !lite;
  // the picked tests with iverilog debug switches on (each its own build, always here)
  const DBG = [['DME_DEBUG', 'D', 'DME debug'], ['DME_DEEP_DEBUG', 'DD', 'DME deep debug'], ['KLR_DEBUG', 'K', 'KLR debug']];
  const dbgTests = ivOn ? Object.keys(debug).filter(t => picked.has(t)) : [];
  const toggleDbg = (t, f) => setDebug(d => {
    const cur = d[t] ?? [];
    const next = cur.includes(f) ? cur.filter(x => x !== f) : [...cur, f];
    const o = { ...d };
    if (next.length) o[t] = next; else delete o[t];
    return o;
  });
  const maxW = lite ? Math.max(8, info?.cpus ?? 8) : 8;
  const w = workers ?? Math.min(8, info?.cpus ?? 8);

  const toggle = names => setSel(() => {
    const s = new Set(picked);
    const on = names.every(n => s.has(n));
    for (const n of names) on ? s.delete(n) : s.add(n);
    return s;
  });

  const nSims = (vl ? 1 : 0) + (ivOn ? 1 : 0);
  // The named ROM pairs ticked (developer install); a custom pair is one
  // (setups saved from the dashboard come as custom presets: a pair to pick, not a run_all.sh --roms pair)
  const presets = (romInfo?.presets ?? []).filter(p => !p.custom);
  const pairList = !lite && !rom ? presets.map(p => p.folder).filter(f => pairs.has(f)) : [];
  const nPairs = Math.max(1, pairList.length);
  const multi = pairList.length > 1;
  const pickedLens = [...picked].map(n => (lite && +simMs > 0 ? Math.min(+simMs / 1000, lenOf[n] ?? 40) : lenOf[n] ?? 40));
  // run_all.sh runs every suite (each simulator, each ROM pair) at the same
  // time, sharing the workers and the hosts' threads: a thread that frees up
  // starts the next waiting test of any suite, longest first in each
  const nSuites = Math.max(1, nSims) * nPairs;
  const est = estimateWall(Array.from({ length: nSuites }, () => pickedLens).flat(), w + remoteW);
  const simTotal = pickedLens.reduce((a, b) => a + b, 0);

  // ── iverilog debug runs: the disk they take ───────────────
  // The bridge's ivDisk (dme_klr/iv_disk_rates.json, measured by
  // iv_disk_usage.sh): MB per simulated second for each combination of
  // the debug flags. A test's estimate is its length times that, plus its
  // own .vvp; "while running" adds the raw .log and VCD the longest W
  // tests hold at once before they are gzipped / turned into FST.
  // per test: its debug switches' rates, if iv_disk_rates.json has that combination
  const rateOf = n => (dbgTests.includes(n) ? info?.ivDisk?.configs?.[[...debug[n]].sort().join('+')] ?? null : null);
  const diskOf = n => { const r = rateOf(n); return r ? (lenOf[n] ?? 40) * r.kept_mb_per_sim_s + (r.build_mb ?? 0) : null; };
  const showDisk = dbgTests.length > 0 && !!info?.ivDisk;
  const diskTotal = nPairs * dbgTests.reduce((a, n) => a + (diskOf(n) ?? 0), 0);   // once per ROM pair
  const diskPeak = dbgTests.map(n => { const r = rateOf(n); return r ? (lenOf[n] ?? 40) * Math.max(0, r.peak_mb_per_sim_s - r.kept_mb_per_sim_s) : 0; })
    .sort((a, b) => b - a).slice(0, w).reduce((a, b) => a + b, 0);
  const diskTitle = n => {
    const r = rateOf(n);
    return r ? `iverilog output with --${[...debug[n]].sort().join(' --')}: about ${r.kept_mb_per_sim_s} MB kept per simulated second `
      + `(FST ${r.fst_mb_per_sim_s} MB/s), up to ${r.peak_mb_per_sim_s} MB/s on disk while it runs; `
      + `from iv_disk_usage.sh (${info.ivDisk.measured?.date ?? 'undated'})`
      : 'No measurement for this combination in dme_klr/iv_disk_rates.json (iv_disk_usage.sh --save-rates)';
  };
  const totalTitle = `iverilog debug output of the ${dbgTests.length} test(s) with D / DD / K on, kept after the run; `
    + `the second figure is the raw log and VCD the ${w} longest of them hold while running, before gzip / vcd2fst`;

  const active = !!run?.running;
  const runPairs = active ? run?.opts?.roms?.pairs : null;    // the run's own, while it goes
  const onePair = pairList.length === 1 ? presets.find(p => p.folder === pairList[0]) : null;
  const romSel = (active && !runPairs && run?.opts?.roms) || rom || onePair || romInfo?.default || { dme:'', klr:'' };
  const romPreset = romInfo?.presets?.find(p => p.dme === romSel.dme && p.klr === romSel.klr);
  // the picked pair's log folder, and the ones there are, for FQS ANALYSIS
  const pickFolder = multi ? pairList[0] : romFolder(romSel.dme, romSel.klr);
  const fqsFolder = fqsRom ?? pickFolder;
  const folders = [...new Set([pickFolder, ...(info?.romFolders ?? [])])];
  const noPair = !lite && !!romInfo && !rom && !pairList.length;
  const start = async () => {
    setBusy('starting');
    const body = { workers: w, interval_ms: +interval || 100, tests: [...picked] };
    body.useHosts = useHosts;
    if (multi) body.pairs = pairList;
    else if (romInfo) body.roms = { dme: romSel.dme, klr: romSel.klr };
    if (lite) { if (+simMs > 0) body.sim_ms = +simMs; }
    else Object.assign(body, { sims: [vl && 'verilator', ivOn && 'iverilog'].filter(Boolean),
                               perTestBuild: perTest, installTests: installList.filter(t => itests.has(t.id) && t.available).map(t => t.id),
                               // an older bridge knows only the two macOS ones
                               macosTest: itests.has('macos-install') ? (itests.has('macos-lite') ? 'both' : 'install') : itests.has('macos-lite') ? 'lite' : 'none',
                               pull, plot,
                               ...(ivOn && dbgTests.length ? { debug: Object.fromEntries(dbgTests.map(t => [t, debug[t]])) } : {}) });
    try {
      const r = await fetch(`${url}/runall/start`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      if (!r.ok) alertLine(setBusy, `couldn't start: ${await r.text() || r.status}`);
      else setBusy(null);
    } catch (e) { alertLine(setBusy, `couldn't start: ${e.message}`); }
    refresh();
  };
  const loadFqs = async rom => {
    setFqs(f => ({ ...(f ?? {}), loading: true }));
    try {
      const r = await fetch(`${url}/runall/fqs?rom=${encodeURIComponent(rom ?? fqsFolder)}`);
      setFqs(r.ok ? await r.json() : { error: `${r.status} ${await r.text()}` });
    } catch (e) { setFqs({ error: e.message }); }
  };
  // ── Changing the run as it goes ───────────────────────────
  // threads: tests at a time here ('local') or on a regression host
  const setThreads = async (host, n) => {
    try {
      const r = await fetch(`${url}/runall/threads`, { method:'POST', headers:{'Content-Type':'application/json'},
                                                       body: JSON.stringify({ host, threads: n }) });
      if (!r.ok) alertLine(setBusy, `threads: ${await r.text() || r.status}`);
    } catch (e) { alertLine(setBusy, `threads: ${e.message}`); }
    refresh();
  };
  // A cancel can't be taken back, so its button asks once more: the first
  // click arms it (CONFIRM?) for a few seconds, the second cancels
  const [armed, setArmed] = useState(null);
  const cancelQueued = async (key, scope) => {
    if (armed !== key) {
      setArmed(key);
      setTimeout(() => setArmed(a => (a === key ? null : a)), 4000);
      return;
    }
    setArmed(null);
    try {
      const r = await fetch(`${url}/runall/cancel`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(scope) });
      if (!r.ok) alertLine(setBusy, `cancel: ${await r.text() || r.status}`);
    } catch (e) { alertLine(setBusy, `cancel: ${e.message}`); }
    refresh();
  };
  const stop = async () => {
    setBusy('stopping');
    try { await fetch(`${url}/runall/stop`, { method:'POST' }); } catch { /* the next poll says */ }
    setBusy(null);
    refresh();
  };

  // ── Styles ────────────────────────────────────────────────
  const box = {background:C.panelBg,border:`1px solid ${C.border}`,borderRadius:'2px',padding:'10px',marginBottom:'10px'};
  const ttl = {color:C.textDim,fontSize:'9px',letterSpacing:'0.2em',textTransform:'uppercase',
               borderBottom:`1px solid ${C.border}`,paddingBottom:'4px',marginBottom:'8px',display:'flex',gap:'8px',alignItems:'baseline'};
  const btn = (v, dis) => ({padding:'6px 16px',background:v==='p'?'#0d4a0d':v==='r'?'#3a0d0d':C.panelBg,
                            border:`1px solid ${v==='p'?C.textBright:v==='r'?C.red:C.border}`,
                            color:dis?C.grey:v==='p'?C.textBright:v==='r'?C.red:C.textDim,fontFamily:'inherit',
                            fontSize:'11px',letterSpacing:'0.1em',cursor:dis?'default':'pointer',opacity:dis?.5:1});
  const lbl = dis => ({display:'flex',alignItems:'center',gap:'6px',color:dis?C.grey:C.textDim,opacity:dis?.55:1,
                       cursor:dis?'not-allowed':'pointer',fontSize:'11px'});
  const inp = {background:'#030803',border:`1px solid ${C.border2}`,color:C.textBright,fontFamily:'inherit',fontSize:'11px',padding:'3px 5px'};
  const locked = active;
  // Step 6's install tests, as the bridge lists them with whether this
  // machine can run each; an older bridge lists none (only macOS, by Tart)
  const installList = info?.installTests ?? [
    { id: 'macos-install', label: 'macOS, developer install (clean VM)' },
    { id: 'macos-lite', label: 'macOS, lite package built here (clean VM)' },
  ].map(t => ({ ...t, available: !!(info?.platform === 'darwin' && info?.tart), why: 'needs macOS with Tart' }));

  // ── Progress views ────────────────────────────────────────
  const suites = run?.suites ?? {};
  const suiteKeys = Object.keys(suites);
  const hasIv = suiteKeys.some(k => suites[k].sim === 'iv' || k === 'iv');
  const runMulti = (run?.roms?.length ?? 1) > 1;
  // "Verilator", or "Verilator · 86" when the run has several ROM pairs
  const suiteName = su => (runMulti && su?.rom ? `${su.label} · ${su.rom}` : su?.label ?? '');
  const testRow = (name, su) => {
    const t = su?.tests?.[name];
    const len = t?.len_s ?? lenOf[name] ?? 40;
    const p = t ? (t.state === 'done' ? 100 : t.state === 'cancelled' ? 0 : pctOf(t.t_s, len)) : 0;
    const col = t?.verdict ? VERDICT_COL[t.verdict] : t?.state === 'running' ? C.blue : C.grey;
    const state = !t ? '' : t.verdict ?? (t.state === 'running' ? `${fmtSim(t.t_s)} / ${fmtSim(len)}` : t.state);
    return (
      <div key={`${su?.label}-${su?.rom ?? ""}-${name}`} style={{display:'flex',alignItems:'center',gap:'8px',padding:'1px 0'}}
           title={t?.detail || undefined}>
        <span style={{width:runMulti ? '120px' : '72px',textAlign:'right',color:C.textDim,fontSize:'10px',whiteSpace:'nowrap'}}>{suiteKeys.length > 1 ? suiteName(su) : ''}</span>
        <Bar pct={p} color={col} height={10} label={`${Math.floor(p)}%`} />
        <span style={{width:'130px',textAlign:'left',color:col,fontSize:'10px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{state}</span>
        <span style={{width:'110px',textAlign:'left',color:C.textDim,fontSize:'10px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}
              title={t?.host ? `Ran on the regression host ${t.host}` : undefined}>{t?.host ? `@${t.host}` : ''}</span>
        {/* step 5's plots of where iverilog and Verilator differ (on the iverilog line) */}
        <span style={{width:'92px',display:'flex',gap:'3px',flexShrink:0}}>
          {/* a test not started yet: cancel it in this suite only (asks once more) */}
          {run?.running && run.cancels && t?.state === 'queued' && (() => {
            const key = `t:${su.sim}:${su.rom ?? ''}:${name}`;
            return (
              <button style={{...btn(armed === key ? 'r' : 's'),padding:'0 5px',fontSize:'9px',lineHeight:'14px',whiteSpace:'nowrap'}}
                title={`Cancel ${name}${suiteKeys.length > 1 ? ` in ${suiteName(su)} only` : ''}: it never starts`}
                onClick={() => cancelQueued(key, { sim: su.sim, rom: su.rom, tests: [name] })}>
                {armed === key ? 'CONFIRM?' : '✕ CANCEL'}</button>
            );
          })()}
          {(su?.sim === 'iv' || !hasIv) && (run?.diffs?.[su?.rom ?? run.rom]?.[name] ?? []).map(ecu => (
            <a key={ecu} href={`${url}/runall/diff?rom=${encodeURIComponent(su?.rom ?? run.rom)}&test=${encodeURIComponent(name)}&ecu=${ecu}&run=${run.id}`} target="_blank" rel="noreferrer"
               title={`${name}${runMulti ? ` (${su.rom})` : ''}: where its iverilog and Verilator ${ecu} values differ (${name}_${ecu}_diff.jpg, compare_sim_logs.py --plot)`}
               style={{padding:'0 4px',fontSize:'9px',lineHeight:'14px',border:`1px solid ${C.amber}`,color:C.amber,textDecoration:'none',whiteSpace:'nowrap'}}>
              ◪ {ecu}</a>
          ))}
        </span>
      </div>
    );
  };
  const groupProgress = g => {
    let d = 0, tot = 0;
    const v = { PASS:0, WARN:0, FAIL:0 };
    let inRun = false;
    for (const su of Object.values(suites)) for (const { name } of g.tests) {
      const t = su.tests[name];
      if (!t || t.state === 'cancelled') continue;
      inRun = true;
      tot += t.len_s; d += t.state === 'done' ? t.len_s : t.t_s;
      if (v[t.verdict] != null) v[t.verdict]++;
    }
    return inRun ? { p: pctOf(d, tot), v } : null;
  };

  // the run's tests not started yet: in a group (every suite), or in the suites of one simulator
  const queuedIn = (names, keep = () => true) => suiteKeys.filter(k => keep(suites[k]))
    .reduce((a, k) => a + names.filter(n => suites[k].tests[n]?.state === 'queued').length, 0);
  const queuedOf = keep => suiteKeys.filter(k => keep(suites[k])).reduce((a, k) => a + suites[k].counts.queued, 0);
  // tests running here (no host) and on each regression host
  const runningOn = host => suiteKeys.reduce((a, k) => a + Object.values(suites[k].tests)
    .filter(t => t.state === 'running' && (t.host ?? null) === host).length, 0);
  const cancelBtn = (key, scope, label, n, title) => (
    <button key={key} style={{...btn(armed === key ? 'r' : 's', !n),padding:'2px 8px',fontSize:'9px'}} disabled={!n}
      title={`${title}: ${n} test${n === 1 ? '' : 's'} not started yet never start; running ones end as they would have`}
      onClick={() => cancelQueued(key, scope)}>{armed === key ? `CONFIRM: CANCEL ${n}?` : `✕ ${label} (${n})`}</button>
  );
  const stepper = (host, n, min, max, name, title) => (
    <span key={host} style={{display:'inline-flex',alignItems:'center',gap:'4px',fontSize:'10px',color:C.textDim}} title={title}>
      {name}
      <button style={{...btn('s', n <= min),padding:'0 6px',fontSize:'11px',lineHeight:'14px'}} disabled={n <= min}
        onClick={() => setThreads(host, n - 1)}>−</button>
      <span style={{color:C.textBright,minWidth:'18px',textAlign:'center'}}>{n}</span>
      <button style={{...btn('s', n >= max),padding:'0 6px',fontSize:'11px',lineHeight:'14px'}} disabled={n >= max}
        onClick={() => setThreads(host, n + 1)}>+</button>
      <span style={{color:C.grey}}>({runningOn(host === 'local' ? null : host)} running)</span>
    </span>
  );

  const stepIcon = s => s.state === 'running' ? '◐' : s.state === 'done' ? '●' : s.state === 'skipped' ? '⊘' : s.state === 'stopped' ? '■' : '○';
  const overall = run ? (run.running ? Math.min(99.9, pctOf(run.done_s, run.total_s)) : run.exit === 0 ? 100 : pctOf(run.done_s, run.total_s)) : 0;
  const runCol = !run ? C.grey : run.running ? C.blue : run.exit === 0 ? C.textBright : run.stopping ? C.amber : C.red;

  return (
    <div style={{position:'fixed',inset:0,background:'#020502ee',zIndex:100,display:'flex',justifyContent:'center',overflow:'auto'}}>
      <div style={{background:C.bg,border:`1px solid #0d4a0d`,borderRadius:'4px',padding:'16px',width:'1100px',maxWidth:'96vw',
                   margin:'2vh 0',height:'fit-content',textAlign:'left',color:C.text}}>
        {/* ── Title ── */}
        <div style={{display:'flex',alignItems:'baseline',gap:'12px',borderBottom:'1px solid #0d4a0d',paddingBottom:'10px',marginBottom:'12px'}}>
          <div style={{color:C.textBright,fontSize:'13px',fontFamily:"'Orbitron',monospace",letterSpacing:'0.08em'}}>▶ RUN REGRESSIONS</div>
          {mode && <span style={{color:'#66ddaa',fontSize:'10px'}}>
            {lite ? 'lite package · run_tests.py' : 'developer install · dme_klr/run_all.sh'} · {url}
          </span>}
          <button style={{...btn('s'),marginLeft:'auto',padding:'3px 10px'}} onClick={onClose}
            title="Close; a run keeps going on the bridge">CLOSE ✕</button>
        </div>
        {err && <div style={{...box,color:C.amber}}>{err}</div>}
        {info && !mode && <div style={{...box,color:C.amber}}>The bridge found neither dme_klr/run_all.sh nor run_tests.py next to it.</div>}

        {mode && <>
        {/* ── Options ── */}
        <div style={box}>
          <div style={ttl}>Options{locked && <span style={{color:C.amber,letterSpacing:0,textTransform:'none'}}>(fixed while a run is going)</span>}</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:'10px 18px'}}>
            {romInfo && <div style={{gridColumn:'1 / -1'}}>
              <div style={{color:C.textDim,fontSize:'9px',letterSpacing:'.15em',marginBottom:'4px'}}>ROM IMAGES (EVERY TEST)</div>
              {!lite && presets.length > 0 && <div style={{display:'flex',flexWrap:'wrap',gap:'4px 16px',alignItems:'center',marginBottom:'5px'}}>
                <span style={{color:C.textDim,fontSize:'10px'}} title="Each test runs once per ticked pair and simulator (run_all.sh --roms), each pair in its own folder">ROM pairs:</span>
                {presets.map(p => {
                  const on = runPairs ? runPairs.includes(p.folder) : !rom && pairs.has(p.folder);
                  return (
                    <label key={p.folder} style={lbl(locked)} title={`${p.name}: DME ${p.dme}, KLR ${p.klr} → tmp/dme_klr/${p.folder}`}>
                      <input type="checkbox" checked={on} disabled={locked} onChange={() => {
                        setRom(null);
                        setPairs(ps => { const n = new Set(rom ? [] : ps); n.has(p.folder) ? n.delete(p.folder) : n.add(p.folder); return n; });
                      }} />{p.folder} <span style={{color:C.textDim,fontSize:'10px'}}>({p.name.replace(/ \(.*\)$/, '')})</span>
                    </label>
                  );
                })}
                {(multi || runPairs?.length > 1) && <span style={{color:C.textDim,fontSize:'10px'}}>
                  each test runs {(runPairs ?? pairList).length * Math.max(1, nSims)} times ({(runPairs ?? pairList).length} pairs × {Math.max(1, nSims)} simulator{nSims === 1 ? '' : 's'}), each pair in its own folder,
                  {' '}<code style={{color:C.text,background:'transparent',fontSize:'10px',padding:0}}>tmp/dme_klr/{'{'}{(runPairs ?? pairList).join(',')}{'}'}</code></span>}
                {!lite && !rom && !pairList.length && !runPairs && <span style={{color:C.amber,fontSize:'10px'}}>Tick a ROM pair, or pick one below.</span>}
              </div>}
              {!(multi || runPairs?.length > 1) && <div style={{display:'flex',flexWrap:'wrap',gap:'6px 14px',alignItems:'center'}}>
                <select value={romPreset ? romPreset.name : 'custom'} disabled={locked} style={inp}
                  title="A DME + KLR pair the developer scripts use (run89.sh, run86.sh, run_carpokes.sh), or any two images"
                  onChange={e => { const p = romInfo.presets.find(x => x.name === e.target.value);
                                   if (p?.custom) setRom({ dme: p.dme, klr: p.klr });
                                   else if (p) { setRom(null); setPairs(new Set([p.folder ?? romFolder(p.dme, p.klr)])); } }}>
                  {romInfo.presets.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                  <option value="custom" disabled={!!romPreset}>custom pair</option>
                </select>
                {['dme', 'klr'].map(cpu => (
                  <label key={cpu} style={lbl(locked)}>
                    <span style={{color:cpu === 'klr' ? C.blue : C.textBright}}>{cpu.toUpperCase()}</span>
                    <select value={romSel[cpu]} disabled={locked} style={inp}
                      onChange={e => { const n = { ...romSel, [cpu]: e.target.value };
                                       const p = presets.find(x => x.dme === n.dme && x.klr === n.klr);
                                       if (p && !lite) { setRom(null); setPairs(new Set([p.folder])); } else setRom(n); }}>
                      {(romInfo.images[cpu] ?? []).map(i => (
                        <option key={i.name} value={i.name}>{i.name}{i.src === 'upload' ? ' (uploaded)' : ''}{i.name === romInfo.default[cpu] ? ' (default)' : ''}</option>
                      ))}
                    </select>
                  </label>
                ))}
                <span style={{color:C.textDim,fontSize:'10px'}}>as DME_ROM_FILE / KLR_ROM_FILE; the CPU regressions keep their own images.
                  The tests' logs go in this pair's folder, <code style={{color:C.text,background:'transparent',fontSize:'10px',padding:0}}>tmp/dme_klr/{pickFolder}</code></span>
              </div>}
            </div>}
            <div>
              <div style={{color:C.textDim,fontSize:'9px',letterSpacing:'.15em',marginBottom:'4px'}}>SIMULATOR</div>
              <label style={lbl(locked)}><input type="checkbox" checked={vl} disabled={locked} onChange={e=>setVl(e.target.checked)} />Verilator</label>
              <label style={lbl(locked || lite)} title={lite ? 'The lite package has only the prebuilt Verilator simulators' : 'run_all.sh steps 4 and 5'}>
                <input type="checkbox" checked={ivOn} disabled={locked || lite} onChange={e=>setIv(e.target.checked)} />iverilog
                {lite && <span style={{fontSize:'9px'}}>(not in the lite package)</span>}
              </label>
              {!lite && !(vl && ivOn) && <div style={{color:C.amber,fontSize:'10px',marginTop:'3px'}}>
                One simulator only: step 5 compares against the other's older logs</div>}
            </div>
            <div>
              <div style={{color:C.textDim,fontSize:'9px',letterSpacing:'.15em',marginBottom:'4px'}}>{lite ? 'TESTS AT A TIME (-j)' : 'WORKERS (THREADS)'}</div>
              <input type="number" min={1} max={maxW} value={w} disabled={locked} style={{...inp,width:'60px'}}
                onChange={e=>setWorkers(Math.min(maxW, Math.max(1, +e.target.value || 1)))} />
              <span style={{color:C.textDim,fontSize:'10px',marginLeft:'8px'}}>{info.cpus} CPUs here; more than that doesn't help</span>
            </div>
            <div>
              <div style={{color:C.textDim,fontSize:'9px',letterSpacing:'.15em',marginBottom:'4px'}}>SNAPSHOT INTERVAL</div>
              <input type="number" min={1} value={interval} disabled={locked} style={{...inp,width:'60px'}}
                onChange={e=>setIntervalMs(e.target.value)} /> <span style={{color:C.textDim,fontSize:'10px'}}>simulated ms (DASH_INTERVAL_MS)</span>
            </div>
            <div>
              <div style={{color:C.textDim,fontSize:'9px',letterSpacing:'.15em',marginBottom:'4px',opacity:lite?.55:1}}>BUILD</div>
              <label style={lbl(locked || lite)} title={lite ? 'run_all.sh only' : 'Build every test on its own instead of one shared testbench'}>
                <input type="checkbox" checked={perTest && !lite} disabled={locked || lite} onChange={e=>setPerTest(e.target.checked)} />per-test build (--per-test-build)
              </label>
              <label style={lbl(locked || lite)} title={lite ? 'run_all.sh only' : 'git checkout main and git pull before the run; off runs the checkout as it is (--no-pull)'}>
                <input type="checkbox" checked={pull && !lite} disabled={locked || lite} onChange={e=>setPull(e.target.checked)} />update first (git checkout main + pull)
              </label>
            </div>
            <div>
              <div style={{color:C.textDim,fontSize:'9px',letterSpacing:'.15em',marginBottom:'4px',opacity:lite?.55:1}}>COMPARISON (STEP 5)</div>
              <label style={lbl(locked || lite)}
                title={lite ? 'run_all.sh only (the lite package has no iverilog to compare with)'
                  : 'Plot where each test\'s iverilog and Verilator logs differ (compare_sim_logs.py --plot; off: --no-plot). '
                    + 'A ◪ DME / ◪ KLR icon on the test\'s line opens its plot'}>
                <input type="checkbox" checked={plot && !lite} disabled={locked || lite} onChange={e=>setPlot(e.target.checked)} />Plot Differences
              </label>
            </div>
            <div>
              <div style={{color:C.textDim,fontSize:'9px',letterSpacing:'.15em',marginBottom:'4px',opacity:lite?.55:1}}
                title="Step 6: each ticked test installs from scratch in a clean VM or container, one after another, once steps 1-5 pass (run_all.sh --install-tests)">INSTALL TESTS (STEP 6)</div>
              {installList.map(t => {
                const dis = locked || lite || !t.available;
                return (
                  <label key={t.id} style={lbl(dis)}
                    title={lite ? 'run_all.sh only' : t.available ? `--install-tests ${t.id}` : `Can't run on this machine: ${t.why}`}>
                    <input type="checkbox" checked={!lite && t.available && itests.has(t.id)} disabled={dis}
                      onChange={e => setItests(s => { const n = new Set(s); e.target.checked ? n.add(t.id) : n.delete(t.id); return n; })} />
                    {t.label}
                  </label>);
              })}
              {!lite && installList.some(t => !t.available) &&
                <div style={{color:C.textDim,fontSize:'10px',marginTop:'3px'}}>Grayed: can't run on this machine (hover for why)</div>}
            </div>
            <div>
              <div style={{color:C.textDim,fontSize:'9px',letterSpacing:'.15em',marginBottom:'4px',opacity:lite?1:.55}}>QUICK CHECK (LITE)</div>
              <input type="number" min={0} placeholder="full length" value={lite ? simMs : ''} disabled={locked || !lite}
                style={{...inp,width:'90px',opacity:lite?1:.55}} onChange={e=>setSimMs(e.target.value)}
                title={lite ? 'Stop every test at this many simulated ms (--sim-ms); verdicts assume the full length' : 'run_tests.py only'} />
              <span style={{color:C.textDim,fontSize:'10px',marginLeft:'6px',opacity:lite?1:.55}}>ms per test (--sim-ms)</span>
            </div>
          </div>
        </div>

        {/* ── Regression hosts: other machines that take some of the tests ── */}
        <div style={box}>
          <div style={ttl}>Regression hosts</div>
          <RegressHosts url={url} state={hostState} locked={locked} useHosts={useHosts} setUseHosts={setUseHosts} lite={lite} />
          <div style={{borderTop:`1px solid ${C.border}`,marginTop:'10px',paddingTop:'8px'}}>
            <div style={{color:C.textDim,fontSize:'9px',letterSpacing:'.15em',marginBottom:'6px'}}>TEST THE NETWORK RUN (INSTALL/TEST_REGRESS_HOSTS.SH)</div>
            <HostTest url={url} info={info} hosts={hostState.hosts?.hosts ?? []} runActive={active} refresh={refresh} />
          </div>
        </div>

        {/* ── Run controls + full-run progress ── */}
        <div style={box}>
          <div style={{display:'flex',alignItems:'center',gap:'12px',flexWrap:'wrap'}}>
            {!active
              ? <button style={btn('p', !picked.size || !nSims || busy || noPair)} disabled={!picked.size || !nSims || !!busy || noPair} onClick={start}>
                  {busy === 'starting' ? 'STARTING…' : `▶ START RUN (${picked.size} test${picked.size === 1 ? '' : 's'})`}</button>
              : <button style={btn('r', !!busy)} disabled={!!busy} onClick={stop}>{busy === 'stopping' || run.stopping ? 'STOPPING…' : '■ STOP RUN'}</button>}
            {!active && <span style={{color:C.textDim,fontSize:'10px'}}>
              {fmtDur(simTotal)} simulated{nSims > 1 || multi ? ` per ${[nSims > 1 && 'simulator', multi && 'ROM pair'].filter(Boolean).join(' and ')}` : ''} · about {fmtDur(est)} at {WALL_PER_SIM_S} s per simulated second
              {' '}with {w} at a time{remoteW ? ` here + ${remoteW} on regression hosts` : ''}
              {nSuites > 1 ? <> ({nSuites} suites at once, sharing them: a free one takes the next waiting test of any suite)</> : ''}{!lite ? ', plus the CPU regressions and comparison' : ''}
              {showDisk && <span style={{color:C.amber}} title={totalTitle}> · iverilog debug output ({dbgTests.length} test{dbgTests.length === 1 ? '' : 's'}):
                about {fmtSize(diskTotal)} on disk (+{fmtSize(diskPeak)} while running)</span>}</span>}
            {busy && busy !== 'starting' && busy !== 'stopping' && <span style={{color:C.red,fontSize:'10px'}}>{busy}</span>}
            {!lite && <button style={{...btn('s'),marginLeft:'auto',padding:'3px 10px',fontSize:'10px'}}
              title="fqs_analysis.py (run_all.sh step 5) on the iverilog and Verilator dash logs as they are now: how each FQS position changes the injector pulse width and the ignition timing"
              onClick={() => (fqs ? setFqs(null) : loadFqs())}>{fqs ? 'HIDE FQS ANALYSIS' : 'FQS ANALYSIS'}</button>}
            {!lite && <button style={{...btn('s'),padding:'3px 10px',fontSize:'10px'}}
              title="Two or more ROM pairs' tests side by side, from the logs each pair's runs left in its folder: verdicts and the values that differ"
              onClick={() => setVariants(v => !v)}>{variants ? 'HIDE ROM VARIANTS' : 'ROM VARIANTS'}</button>}
          </div>
          {variants && <RomVariants url={url} folders={folders} pickFolder={pickFolder} active={active} btn={btn} inp={inp} />}
          {fqs && <div style={{marginTop:'10px',borderTop:`1px solid ${C.border}`,paddingTop:'8px'}}>
            <div style={{display:'flex',alignItems:'center',gap:'10px',fontSize:'10px',color:C.textDim}}>
              <span style={{color:C.textBright,letterSpacing:'.15em',fontSize:'9px'}}>FQS ANALYSIS</span>
              <span>{fqs.loading ? 'running fqs_analysis.py…' : fqs.error ? <span style={{color:C.red}}>{fqs.error}</span>
                : `fqs_analysis.py on the ${fqs.rom ?? fqsFolder} logs as of ${new Date(fqs.at).toLocaleTimeString()}${fqs.exit ? ` (exit ${fqs.exit})` : ''}`}</span>
              <label style={{display:'flex',alignItems:'center',gap:'5px'}} title="Whose logs: each ROM pair's runs are in its own folder, tmp/dme_klr/<folder>">ROM folder
                <select value={fqsFolder} disabled={fqs.loading} style={{...inp,fontSize:'10px',padding:'1px 4px'}}
                  onChange={e => { setFqsRom(e.target.value); loadFqs(e.target.value); }}>
                  {folders.map(f => <option key={f} value={f}>{f}</option>)}
                </select></label>
              {active && <span style={{color:C.amber}}>a run is going: tests not done yet show their older logs or none</span>}
              <button style={{...btn('s', fqs.loading),marginLeft:'auto',padding:'2px 8px',fontSize:'9px'}} disabled={fqs.loading}
                onClick={() => loadFqs()}>REFRESH</button>
            </div>
            {fqs.text != null && <pre style={{background:'#030803',border:`1px solid ${C.border}`,color:'#00cc66',fontSize:'10px',padding:'8px',
                                              maxHeight:'480px',overflow:'auto',whiteSpace:'pre',lineHeight:1.35,margin:'6px 0 0'}}>{fqs.text}</pre>}
          </div>}
          {run && <div style={{marginTop:'10px'}}>
            <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
              <span style={{width:'72px',textAlign:'right',color:C.textBright,fontSize:'10px',letterSpacing:'.1em'}}>FULL RUN</span>
              <Bar pct={overall} color={runCol} height={16} label={`${overall.toFixed(1)}%`}
                title="Simulated seconds done of every picked test's length, over all simulators" />
              <span style={{width:'210px',fontSize:'10px',color:runCol}}>
                {run.running ? `${fmtDur(run.elapsed_s)} so far · ${run.eta_s != null ? `~${fmtDur(run.eta_s)} left` : 'estimating…'}`
                  : `${run.stopping ? 'stopped' : run.exit === 0 ? 'finished' : `ended (exit ${run.exit})`} after ${fmtDur(run.elapsed_s)}`}
              </span>
            </div>
            <div style={{color:C.textDim,fontSize:'10px',margin:'4px 0 0 82px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}
                 title={run.command}>{run.command}</div>
            {run.opts?.hosts?.length > 0 && <div style={{color:C.textDim,fontSize:'10px',margin:'2px 0 0 82px'}}>
              also on: {run.opts.hosts.map(h => `${h.name} (${h.threads})`).join(' · ')}</div>}
            {/* While it runs: tests at a time per machine, and cancelling the tests not started yet */}
            {run.running && !run.threads && <div style={{color:C.amber,fontSize:'10px',margin:'8px 0 0 82px'}}>
              THREADS and CANCEL QUEUED need the updated bridge (944turbo_dme_klr): git pull, then restart dme_klr/live/bridge.mjs.
              A run the old bridge started can't be changed (restarting the bridge stops it).</div>}
            {run.running && run.threads && <div style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:'6px 16px',margin:'8px 0 0 82px'}}>
              <span style={{color:C.textDim,fontSize:'9px',letterSpacing:'.15em'}}
                title="Tests at a time on each machine, from the next test that starts; a test already running ends as it would have">THREADS</span>
              {stepper('local', run.threads.local, 1, run.threads.maxLocal, 'here',
                `Tests at a time on this machine (1 to ${run.threads.maxLocal})${suiteKeys.length > 1 ? ', shared by every suite' : ''}`)}
              {Object.entries(run.threads.hosts ?? {}).map(([id, n]) => stepper(id, n, 0, 64, id,
                `Tests at a time on the regression host ${id} (0: no more tests there)`))}
            </div>}
            {run.running && run.cancels && <div style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:'6px 8px',margin:'6px 0 0 82px'}}>
              <span style={{color:C.textDim,fontSize:'9px',letterSpacing:'.15em',marginRight:'8px'}}>CANCEL QUEUED</span>
              {suiteKeys.some(k => suites[k].sim === 'vl') && cancelBtn('vl', { sim:'vl' }, 'ALL VERILATOR', queuedOf(su => su.sim === 'vl'), 'Every Verilator suite')}
              {suiteKeys.some(k => suites[k].sim === 'iv') && cancelBtn('iv', { sim:'iv' }, 'ALL IVERILOG', queuedOf(su => su.sim === 'iv'), 'Every iverilog suite')}
              {suiteKeys.length > 1 && cancelBtn('all', {}, 'EVERYTHING', queuedOf(() => true), 'Every suite')}
              <span style={{color:C.grey,fontSize:'10px'}}>or a test group's, on its line below, or one test's, on its line{runMulti ? ", or one suite's, on its bar" : ''}</span>
            </div>}
            {/* The steps (run_all.sh's 1/6 … 6/6) */}
            <div style={{display:'flex',flexWrap:'wrap',gap:'4px 14px',margin:'8px 0 0 82px',fontSize:'10px'}}>
              {run.steps.map(s => (
                <span key={s.n} title={s.note || undefined}
                      style={{color:s.verdict ? VERDICT_COL[s.verdict] : s.state === 'running' ? C.blue : C.grey}}>
                  {stepIcon(s)} {run.steps.length > 1 ? `${s.n}/${run.steps.length} ` : ''}{s.label}
                  {s.verdict ? ` · ${s.verdict}` : s.state === 'skipped' ? ' · skipped' : ''}
                </span>
              ))}
            </div>
            {/* What step 5's Plot Differences did, per ROM pair (run_all.sh's "Plot Differences (<rom>): ..." line) */}
            {(() => {
              const notes = Object.entries(run.plotNotes ?? {});
              const nPlots = Object.values(run.diffs ?? {}).reduce((a, t) => a + Object.values(t).reduce((b, l) => b + l.length, 0), 0);
              const step5 = run.steps.find(s => s.n === 5);
              // a bridge from before plotNotes: say only what the run's diffs show, once step 5 is over
              if (!notes.length && run.opts?.plot && step5 && step5.state === 'done' && !run.running)
                notes.push([null, nPlots ? `${nPlots} plot(s), the ◪ icons on the iverilog lines below`
                  : 'nothing to plot, no test differed between iverilog and Verilator (only DIFF tests are plotted, not NOTE)']);
              if (!notes.length) return null;
              return (
                <div style={{margin:'4px 0 0 82px',fontSize:'10px',color:C.textDim,display:'flex',flexDirection:'column',gap:'2px'}}
                     title="run_all.sh step 5: compare_sim_logs.py --plot on each test whose iverilog and Verilator logs differ (DIFF or NOTE)">
                  {notes.map(([rom, txt]) => {
                    // every plot step 5 made for this pair, as links: step 5 compares every
                    // log in the pair's folder, so a plotted test may not be one this run ran
                    const r = rom ?? run.rom;
                    const plots = Object.entries(run.diffs?.[r] ?? {}).sort(([a], [b]) => a.localeCompare(b));
                    return (
                      <span key={rom ?? '-'} style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:'3px 6px'}}>
                        <span><span style={{color:C.amber}}>◪</span> PLOT DIFFERENCES{rom && (runMulti || notes.length > 1) ? ` · ${rom}` : ''}: {txt}</span>
                        {plots.map(([test, ecus]) => {
                          const inRun = suiteKeys.some(k => suites[k].tests?.[test]);
                          return (
                          <span key={test} style={{display:'inline-flex',alignItems:'center',gap:'3px',whiteSpace:'nowrap'}}>
                            <span style={{color:inRun ? C.text : C.textDim}}
                                  title={inRun ? undefined : `${test} wasn't in this run: step 5 compared its logs from an earlier run`}>{test}{inRun ? '' : ' (earlier run)'}</span>
                            {ecus.map(ecu => (
                              <a key={ecu} href={`${url}/runall/diff?rom=${encodeURIComponent(r)}&test=${encodeURIComponent(test)}&ecu=${ecu}&run=${run.id}`}
                                 target="_blank" rel="noreferrer"
                                 title={`${test}: where its iverilog and Verilator ${ecu} values differ (${test}_${ecu}_diff.jpg)`}
                                 style={{padding:'0 4px',fontSize:'9px',lineHeight:'14px',border:`1px solid ${C.amber}`,color:C.amber,textDecoration:'none'}}>
                                ◪ {ecu}</a>
                            ))}
                          </span>
                          );
                        })}
                      </span>
                    );
                  })}
                </div>
              );
            })()}
            {/* One bar per dashboard suite */}
            {suiteKeys.map(k => {
              const su = suites[k];
              return (
                <div key={k} style={{display:'flex',alignItems:'center',gap:'10px',marginTop:'6px'}}>
                  <span style={{width:runMulti ? '120px' : '72px',textAlign:'right',color:C.textDim,fontSize:'10px',whiteSpace:'nowrap'}}>{suiteName(su)}</span>
                  <Bar pct={pctOf(su.done_s, su.total_s)} color={C.text} height={10} label={`${pctOf(su.done_s, su.total_s).toFixed(1)}%`} />
                  <span style={{width:'210px',fontSize:'10px',color:C.textDim}}>
                    {su.building ? 'building the testbench… · ' : ''}{su.counts.done}/{Object.keys(su.tests).length - (su.counts.cancelled ?? 0)} done
                    {su.counts.cancelled ? <span style={{color:C.grey}}> · {su.counts.cancelled} cancelled</span> : null}
                    {su.counts.running ? ` · ${su.counts.running} running` : ''}
                    {su.counts.PASS ? <span style={{color:VERDICT_COL.PASS}}> · {su.counts.PASS} PASS</span> : null}
                    {su.counts.WARN ? <span style={{color:VERDICT_COL.WARN}}> · {su.counts.WARN} WARN</span> : null}
                    {su.counts.FAIL ? <span style={{color:VERDICT_COL.FAIL}}> · {su.counts.FAIL} FAIL</span> : null}
                  </span>
                  {run.running && runMulti && <span style={{width:'150px'}}>
                    {cancelBtn(`su:${k}`, { sim: su.sim, rom: su.rom }, 'CANCEL', su.counts.queued, `${suiteName(su)}`)}</span>}
                </div>
              );
            })}
          </div>}
        </div>

        {/* ── Test groups (the manuals' Appendix A) ── */}
        <div style={box}>
          <div style={ttl}>
            Test groups <span style={{letterSpacing:0,textTransform:'none'}}>as in the manuals' Appendix A{!lite &&
              <> · D / DD / K on a test: its iverilog DME / DME deep / KLR debug output (large; that test runs here, built on its own)</>}</span>
            <span style={{marginLeft:'auto',display:'flex',gap:'6px'}}>
              <button style={{...btn('s', locked),padding:'2px 8px',fontSize:'9px'}} disabled={locked} onClick={()=>setSel(null)}>ALL</button>
              <button style={{...btn('s', locked),padding:'2px 8px',fontSize:'9px'}} disabled={locked} onClick={()=>setSel(new Set())}>NONE</button>
              <button style={{...btn('s'),padding:'2px 8px',fontSize:'9px'}}
                onClick={()=>setOpen(o => Object.values(o).some(Boolean) ? {} : Object.fromEntries(groups.map(g => [g.name, true])))}>
                {Object.values(open).some(Boolean) ? 'COLLAPSE' : 'EXPAND'}</button>
            </span>
          </div>
          {groups.map(g => {
            const names = g.tests.map(t => t.name);
            const n = names.filter(x => picked.has(x)).length;
            const gp = groupProgress(g);
            const isOpen = !!open[g.name];
            const sim = g.tests.reduce((a, t) => a + t.sim_s, 0);
            const gDbg = names.filter(x => dbgTests.includes(x));
            const gDisk = gDbg.reduce((a, x) => a + (diskOf(x) ?? 0), 0);
            return (
              <div key={g.name} style={{borderTop:`1px solid ${C.border}`,padding:'4px 0'}}>
                <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                  <input type="checkbox" checked={n === names.length} disabled={locked}
                    ref={el => { if (el) el.indeterminate = n > 0 && n < names.length; }}
                    onChange={()=>toggle(names)} title="Pick or drop the whole group" />
                  <span style={{cursor:'pointer',color:C.textBright,width:'400px',flexShrink:0}} onClick={()=>setOpen(o => ({...o, [g.name]: !isOpen}))}>
                    {isOpen ? '▾' : '▸'} {g.name}
                    <span style={{color:C.textDim,fontSize:'10px'}}> · {n}/{names.length} tests · {fmtDur(sim)}</span>
                    {gDbg.length > 0 && <span style={{color:C.amber,fontSize:'10px'}} title={totalTitle}> · {gDbg.length} with iverilog debug
                      {showDisk ? ` · ~${fmtSize(gDisk)}` : ''}</span>}
                  </span>
                  {g.anchor && <a href={`${DOCS_URL}/${info.manual ?? 'docs/USER_MANUAL.md'}#${g.anchor}`} target="_blank" rel="noopener noreferrer"
                     style={{...btn('s'),padding:'2px 8px',fontSize:'9px',textDecoration:'none',flexShrink:0,display:'inline-block',lineHeight:'normal'}}
                     title={`What the ${g.name} tests check: the ${lite ? 'user' : 'developer'} manual, Appendix A`}>MANUAL ↗</a>}
                  {run?.running && run.cancels && queuedIn(names) > 0 && cancelBtn(`g:${g.name}`, { tests: names }, 'CANCEL', queuedIn(names),
                    `The ${g.name} group${suiteKeys.length > 1 ? ', in every suite' : ''}`)}
                  {gp ? <>
                    <Bar pct={gp.p} color={gp.v.FAIL ? C.red : gp.v.WARN ? C.amber : C.text} height={10} label={`${Math.floor(gp.p)}%`} />
                    <span style={{width:'130px',fontSize:'10px',color:C.textDim}}>
                      {gp.v.PASS ? <span style={{color:VERDICT_COL.PASS}}>{gp.v.PASS} PASS </span> : null}
                      {gp.v.WARN ? <span style={{color:VERDICT_COL.WARN}}>{gp.v.WARN} WARN </span> : null}
                      {gp.v.FAIL ? <span style={{color:VERDICT_COL.FAIL}}>{gp.v.FAIL} FAIL</span> : null}
                    </span>
                  </> : <span style={{flex:1}} />}
                </div>
                {isOpen && <div style={{margin:'4px 0 6px 22px'}}>
                  {g.tests.map(t => (
                    <div key={t.name} style={{display:'flex',alignItems:'flex-start',gap:'8px',padding:'1px 0'}}>
                      <label style={{...lbl(locked),width:'378px',flexShrink:0}}>
                        <input type="checkbox" checked={picked.has(t.name)} disabled={locked} onChange={()=>toggle([t.name])} />
                        <span style={{color:picked.has(t.name) ? C.text : C.grey}}>{t.name}</span>
                        <span style={{color:C.textDim,fontSize:'10px',marginLeft:'auto'}}>{fmtSim(t.sim_s)}</span>
                      </label>
                      {!lite && <span style={{display:'flex',gap:'3px',flexShrink:0}}>
                        {DBG.map(([f, short, long]) => {
                          const on = ivOn && (debug[t.name] ?? []).includes(f);
                          const dis = locked || !ivOn || !picked.has(t.name);
                          return (
                            <button key={f} disabled={dis} onClick={()=>toggleDbg(t.name, f)}
                              title={!ivOn ? 'iverilog debug: tick iverilog first'
                                : `${long} (--${f}) for ${t.name} in the iverilog suite: built on its own, always on this machine; large dumps`}
                              style={{padding:'0 5px',fontSize:'9px',fontFamily:'inherit',lineHeight:'14px',cursor:dis?'default':'pointer',
                                      background:on ? '#2a1a00' : C.panelBg,border:`1px solid ${on ? C.amber : C.border}`,
                                      color:on ? C.amber : dis ? '#334433' : C.textDim}}>{short}</button>
                          );
                        })}
                      </span>}
                      {!lite && <span style={{width:'58px',flexShrink:0,textAlign:'right',color:C.amber,fontSize:'10px',lineHeight:'16px'}}
                        title={dbgTests.includes(t.name) ? diskTitle(t.name) : undefined}>
                        {dbgTests.includes(t.name) && info?.ivDisk ? (diskOf(t.name) != null ? `~${fmtSize(diskOf(t.name))}` : '?') : ''}</span>}
                      <div style={{flex:1,display:'flex',flexDirection:'column'}}>
                        {suiteKeys.filter(k => suites[k].tests[t.name]).map(k => testRow(t.name, suites[k]))}
                      </div>
                    </div>
                  ))}
                </div>}
              </div>
            );
          })}
        </div>

        {/* ── Running now, and the output ── */}
        {run && <div style={box}>
          <div style={ttl}>Running now</div>
          {suiteKeys.flatMap(k => Object.entries(suites[k].tests).filter(([, t]) => t.state === 'running').map(([name]) => (
            <div key={`${k}-${name}`} style={{display:'flex',alignItems:'center',gap:'8px'}}>
              <span style={{width:'400px',color:C.text,fontSize:'11px'}}>{name}</span>
              <div style={{flex:1}}>{testRow(name, suites[k])}</div>
            </div>
          )))}
          {!suiteKeys.some(k => suites[k].counts.running) &&
            <div style={{color:C.textDim,fontSize:'10px'}}>{run.running ? 'No dashboard test running (another step, or the build)' : 'Nothing; the run has ended'}</div>}
          <div style={{marginTop:'8px'}}>
            <button style={{...btn('s'),padding:'2px 8px',fontSize:'9px'}} onClick={()=>setShowOut(v=>!v)}>
              {showOut ? 'HIDE OUTPUT' : 'SHOW OUTPUT'}</button>
          </div>
          {showOut && <pre style={{background:'#030803',border:`1px solid ${C.border}`,color:'#00cc66',fontSize:'10px',padding:'8px',
                                   maxHeight:'320px',overflow:'auto',whiteSpace:'pre-wrap',margin:'6px 0 0'}}>
            {run.out.join('\n')}</pre>}
        </div>}
        </>}
      </div>
    </div>
  );
}

// A start error shows for a few seconds in place of the busy state
function alertLine(setBusy, msg) {
  setBusy(msg);
  setTimeout(() => setBusy(b => (b === msg ? null : b)), 6000);
}
