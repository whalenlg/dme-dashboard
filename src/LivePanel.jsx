import { useState, useMemo, useEffect, useLayoutEffect, useRef, useCallback, memo } from "react";
import { fmtBoost, boostParts } from "./boost.js";
import { thin, syncNearest, inRange } from "./thin.js";
import { useZoom, zoomHandlers, ZoomBox, DragArea, ZoomBar } from "./zoom.jsx";
import { dmeOperandValues, klrOperandValues, decodeStack, cameFrom, traceState, STACK } from "./asmValues.js";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { memName } from "./memDefs.js";
import { MemSearch } from "./memSearch.jsx";
import { Popout } from "./popout.jsx";
import RomCompare from "./RomCompare.jsx";
import { RomName, EditsList } from "./romEdits.jsx";
import { MODIFIED, downloadBin } from "./romNames.js";

// ─────────────────────────────────────────────────────────────────
//  LIVE PANEL — controls for a running simulator (see liveSim.js)
//  Run / pause / step, sim inputs, and DME + KLR disassembly with the
//  current PC, recent instruction trace and click-to-toggle breakpoints.
// ─────────────────────────────────────────────────────────────────

// Palette mirrors C in App.jsx
const C = {
  panelBg:'#060e06', panelBg2:'#0a150a', border:'#0d2e0d', border2:'#1a3a1a',
  text:'#00e060', textDim:'#ccddcc', textBright:'#00ff80', amber:'#ffaa00', red:'#ff4444', blue:'#44aaff',
};
const hx = (v, n = 2) => v == null || isNaN(v) ? '--' : v.toString(16).toUpperCase().padStart(n, '0');

// Raw byte inputs; hints come from the testbench's own nominal/fault values.
// The sim runs the closed-loop engine model: TPS is the driver's throttle,
// and RPM, AFM and boost are computed unless unticked from auto (pinned).
const INPUTS = [
  { k:'tps',       label:'THROTTLE (TPS)', hint:'28 idle · 72 ≈3000 rpm · D8 ≈6400 rpm' },
  { k:'rpm',       label:'RPM',          auto:true, max:7000, step:10, dec:true, pin:840, hint:'auto = torque-balance model' },
  { k:'afm',       label:'AFM (ch0)',    auto:true, pin:0x28, hint:'auto follows throttle ~250 ms later' },
  // Max F5: the KLR adds 10 to ch4 before storing ram[52h], so higher wraps to vacuum (the sim caps it there too)
  { k:'boost',     label:'BOOST MAP (KLR ch4)', auto:true, max:0xF5, pin:0x85, hint:'auto = MAP model (vacuum below boost onset, then the boost table) · max F5 ≈ +16 psi' },
  { k:'fuel_qual', label:'FQS (ch7)',    positions:[0x00,0x3B,0x5A,0x75,0x81,0x91,0x9C,0xA7],
    hint:'switch position (ch7 raw 00…A7, as the FQS0..7 tests); also scales model fuel energy' },
  { k:'coolant',   label:'COOLANT (ch3)', hint:'31 ≈85°C/184°F default · 68 ≈48°C · C0 ≈−2°C · 00 shorted' },
  { k:'airtemp',   label:'AIR TEMP (ch2)', hint:'9E ≈20°C default · 50 ≈62°C · 00 shorted' },
  { k:'battery',   label:'BATTERY (ch1)', hint:'V ≈ raw×0.0526+2.13', volts:true },
  // ch4 is the altitude switch plus the region coding plug. The ROM looks
  // 14h up in the 4-band table at 1296h (edges 2E / 80 / C8) and writes
  // 25h.7 (high altitude) and 25h.6 (REGION_CODE, 0 = US, 1 = RoW). The
  // RoW plug adds a 1.8k resistor, which puts ch4 at ~3V (99) at sea level.
  { k:'altitude',  label:'ALTITUDE (ch4)', positions:[0xF8,0x00,0x99,0x56],
    names:['US under 1000 m','US over 1000 m','RoW under 1000 m','RoW over 1000 m'],
    hint:'ch4 raw F8 ≈4.9V / 00 0V (US, as TEST_IDLE_HIGH_ALT) · 99 ≈3.0V / 56 ≈1.7V (RoW plug, 1.8k) → 25h.7:6 = 00 / 10 / 01 / 11 · RoW (25h.6 = 1) runs open loop: LAMBDA_ENABLE 20h.7 off' },
  { k:'ac',        label:'AC (T1)',      positions:[0,1], names:['off','on'],
    hint:'DME T1 (P3.5): AC compressor; the closed-loop model adds its load and the ISV should catch it' },
  { k:'cat',       label:'CAT (T0)',     positions:[0,1], names:['fitted','not fitted'],
    hint:'DME T0 (P3.4): the firmware\'s has-cat flag (0 = fitted). Not fitted: no O2 sensor, both O2 pins held at 0' },
  { k:'o2',        label:'O2 SENSOR',    positions:['auto',0,1,3], names:['auto','lean','cross','rich'],
    hint:'auto follows the model\'s mixture; lean / cross / rich pin the comparator outputs (P1.6/P1.7). CAT not fitted overrides: both pins 0' },
];

const btn = (on, col = C.textBright) => ({
  padding:'4px 10px', background: on ? '#0d4a0d' : C.panelBg2, border:`1px solid ${on ? col : C.border}`,
  color: on ? col : C.textDim, fontFamily:'inherit', fontSize:'10px', letterSpacing:'0.08em', cursor:'pointer',
});
const inp = { background:'#030803', border:`1px solid ${C.border}`, color:C.textBright, fontFamily:'inherit',
              fontSize:'10px', padding:'3px 5px' };
const panel = { background:C.panelBg, border:`1px solid ${C.border}`, borderRadius:'2px', padding:'8px 10px' };
const title = { color:C.textDim, fontSize:'9px', letterSpacing:'0.2em', textTransform:'uppercase', marginBottom:'6px' };

export default function LivePanel({ live, url, follow, setFollow, series, mem, popouts, onClose }) {
  const { connected, sim, inputs, bps, bpConds, trace, traceCtx, error, asm, asmSrc, regs, roms, send, restart, loadRom } = live;
  const running = sim.state === 'running';
  // ROM compare opens in a window of its own (see popouts.js)
  const compareWin = popouts.wins.rom_compare;
  const comparing = !!compareWin;
  const toggleCompare = () => comparing ? popouts.close('rom_compare')
                                        : popouts.open('rom_compare', 'COMPARE ROM IMAGES — DME 951 live', 1280, 900);
  // The DME and KLR code debuggers each open in a window of their own
  const codeWin = { dme: popouts.wins.code_dme, klr: popouts.wins.code_klr };
  const stopKey = running ? null : `${sim.tNs}:${sim.reason}`;

  // Ask for the instruction trace whenever the sim stops
  useEffect(() => {
    if (sim.state === 'paused') send('trace dme 512\ntrace klr 512');   // all the sim keeps
  }, [sim.state, sim.tNs, send]);

  // ✕ hides the warnings seen so far; a new warning (a new list) brings the box back
  const [warnsHidden, setWarnsHidden] = useState(null);
  const newWarns = live.warnings !== warnsHidden;
  const tMs = (sim.tNs / 1e6).toFixed(3);
  return (
    <div style={{display:'flex',flexDirection:'column',gap:'8px',marginBottom:'10px'}}>
      {/* ── Run controls ───────────────────────────────────────── */}
      <div style={{...panel,display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
        <span style={{color: !connected ? C.red : running ? C.textBright : C.amber, fontSize:'11px', minWidth:'90px'}}>
          ● {!connected ? 'OFFLINE' : sim.state.toUpperCase()}
        </span>
        <span style={{color:C.textBright,fontFamily:"'Orbitron',monospace",fontSize:'13px'}}>t={tMs} ms</span>
        {running && sim.rate != null &&
          <span style={{color:C.textDim,fontSize:'9px'}}>{sim.rate.toFixed(1)} sim ms/s ({(1000 / sim.rate).toFixed(0)}× slower than real)</span>}
        {!running && <StopReason reason={sim.reason} />}
        <span style={{flex:1}} />
        <button style={btn(running)} onClick={() => send('run')} disabled={running}>▶ RUN</button>
        <button style={btn(!running, C.amber)} onClick={() => send('pause')} disabled={!running}>⏸ PAUSE</button>
        <span style={{color:'#779977',fontSize:'9px'}} title="Step, RUN TO and breakpoints are in the DME CODE and KLR CODE windows">
          step / breakpoints: open DME CODE or KLR CODE ↗</span>
        <button style={btn(false, C.red)} onClick={restart} title="Kill the sim and start again at t=0">↺ RESTART</button>
        <label style={{color:C.textDim,fontSize:'10px',cursor:'pointer'}}>
          <input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} /> FOLLOW
        </label>
        <ResolutionBox interval={live.interval} connected={connected} send={send} />
        <button style={btn(false)} onClick={onClose}>✕ DISCONNECT</button>
      </div>
      <RomRow url={url} setupsVer={live.setupsVer} roms={roms} asmSrc={asmSrc} paused={connected && sim.state === 'paused'} loadRom={loadRom}
              comparing={comparing} toggleCompare={toggleCompare} />
      <SnapshotPanel live={live} running={running} url={url} />
      {error && <div style={{...panel,color:C.red,fontSize:'11px'}}>
        {error}{!connected && <> — start it with <code>node dme_klr/live/bridge.mjs</code> in 944turbo_dme_klr ({url})</>}
      </div>}

      {/* Sim inputs | live engine stats */}
      <div className="live-cols">
        <InputsPanel inputs={inputs} send={send} />
        <div style={{display:'flex',flexDirection:'column',gap:'8px',minWidth:0}}>
          {live.warnings.length > 0 && newWarns && (
            <div style={{...panel,borderColor:C.red,fontSize:'10px',maxHeight:'90px',overflowY:'auto',textAlign:'left'}}>
              <div style={{...title,color:C.red,marginBottom:'3px',display:'flex',justifyContent:'space-between'}}>
                <span>SIM WARNINGS ({live.warnings.length})</span>
                <button onClick={() => setWarnsHidden(live.warnings)} title="Close (it comes back on a new warning)"
                        style={{background:'none',border:'none',color:C.red,cursor:'pointer',fontFamily:'inherit',fontSize:'12px',padding:0}}>✕</button>
              </div>
              {live.warnings.slice().reverse().map((w, i) => {
                const snap = live.snapshots?.find(s => s.trigger === w);
                return (
                  <div key={i} style={{color: i === 0 ? C.red : '#aa6666',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                    {snap && <span title={`Snapshot ${snap.id} saved at this warning: click to load it`} style={{cursor:'pointer',marginRight:'4px'}}
                                   onClick={() => confirm(`Restart the simulator from snapshot ${snap.id}?`) && live.loadSnapshot(snap.id)}>📷</span>}
                    {w}
                  </div>
                );
              })}
            </div>
          )}
          <EngineRow series={series} />
        </div>
      </div>

      <Popout entry={compareWin} title="COMPARE ROM IMAGES" sub="maps, tables and code that differ between two images, or across all of them">
        <RomCompare url={url} roms={roms} onClose={() => popouts.close('rom_compare')} />
      </Popout>

      {/* The code debuggers, each in its own window */}
      {['dme', 'klr'].map(cpu => (
        <Popout key={cpu} entry={codeWin[cpu]} title={`${cpu.toUpperCase()} CODE`}
                sub={`live simulation · ${!connected ? 'OFFLINE' : sim.state} · t=${tMs} ms`}>
          {/* Fills the window: the listing and the trace share its height */}
          <div style={{textAlign:'left',display:'flex',flexDirection:'column',gap:'8px',height:'100%',minHeight:'520px'}}>
            <RunBar cpu={cpu} sim={sim} connected={connected} running={running} send={send} restart={restart} />
            <AsmPanel cpu={cpu} name={cpu === 'dme' ? 'DME 8051' : 'KLR 8048'} listing={asm[cpu]} pc={cpu === 'dme' ? sim.dmePc : sim.klrPc}
                      bps={bps[cpu]} conds={bpConds?.[cpu]} reason={sim.reason} trace={trace[cpu]} traceCtx={traceCtx?.[cpu]}
                      ram={mem?.[cpu]} regs={regs?.[cpu]} running={running} stopKey={stopKey} send={send}
                      paused={connected && sim.state === 'paused'} edited={asmSrc?.[cpu]?.patched ?? 0} rom={roms?.[cpu]} url={url}
                      patchRom={live.patchRom} revertRom={live.revertRom}
                      watches={live.watches?.[cpu]} watchOk={live.watches != null} writes={live.writes?.[cpu]} writers={live.writers?.[cpu]}
                      connected={connected}
                      onClose={() => popouts.close(`code_${cpu}`)} />
          </div>
        </Popout>
      ))}
    </div>
  );
}

// Why the sim stopped: a breakpoint hit (with its condition), else the reason
function StopReason({ reason }) {
  if (!reason) return null;
  const w = watchHitOf(reason);
  if (w) return (
    <span style={{color:C.amber,fontSize:'10px'}}>
      stopped: watch · <span style={{color:C.blue}}>{watchText(w)}</span>
      <span style={{color:C.textDim}}> changed by the instruction at {w.by} (the PC is now the next one)</span>
    </span>
  );
  const h = bpHitOf(reason);
  if (!h) return <span style={{color:C.amber,fontSize:'10px'}}>stopped: {reason}</span>;
  return (
    <span style={{color:C.amber,fontSize:'10px'}}>
      stopped: bp {h.cpu} {h.pc} · <span style={{color:C.blue}}>{hitText(h)}</span>
      <span style={{color:C.textDim}}> (condition {h.op} {h.bit != null ? h.val : `${hx(h.val)}h`})</span>
    </span>
  );
}

// ── Resolution: simulated ms between DS snapshots (the points of the
// live stats and charts), sim_main's "interval" command. 1 ms minimum;
// applied on Enter or when the box loses focus. The bridge keeps it
// across restarts and snapshot loads.
const RES_MIN = 1, RES_MAX = 10000;
function ResolutionBox({ interval, connected, send }) {
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  const cur = interval?.ms;
  const shown = editing ? text : (cur ?? '');
  const n = Math.round(+text);
  const bad = editing && text !== '' && !(Number.isFinite(+text) && n >= RES_MIN && n <= RES_MAX);
  const apply = () => {
    setEditing(false);
    if (text === '' || bad || n === cur) return;
    send(`interval ${n}`);
  };
  const off = !connected || !interval;
  return (
    <label style={{color:C.textDim,fontSize:'10px',display:'inline-flex',alignItems:'center',gap:'4px'}}
           title={!interval ? 'This simulator build has no resolution setting: rebuild it (dme_klr/live/build_live.sh)'
             : `Simulated time between snapshots (the points of the live stats and charts), ${RES_MIN} to ${RES_MAX} ms; `
               + `build default ${interval.def} ms. Smaller is finer but slows the sim and keeps less history.`}>
      RESOLUTION
      <input type="number" min={RES_MIN} max={RES_MAX} step={1} value={shown} disabled={off}
             onFocus={() => { setText(String(cur ?? '')); setEditing(true); }}
             onChange={e => setText(e.target.value)} onBlur={apply}
             onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setEditing(false); e.currentTarget.blur(); } }}
             title={bad ? `${RES_MIN} to ${RES_MAX} ms` : undefined}
             style={{...inp,width:'52px',borderColor: bad ? C.red : C.border}} /> ms
    </label>
  );
}

// ── Run / pause / step / run-to / restart, at the top of each code window ──
function RunBar({ cpu, sim, connected, running, send, restart }) {
  const [stepN, setStepN]   = useState(1);
  const [untilMs, setUntil] = useState('');
  const CPU = cpu.toUpperCase();
  return (
    <div style={{...panel,display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
      <span style={{color: !connected ? C.red : running ? C.textBright : C.amber, fontSize:'11px', minWidth:'80px'}}>
        ● {!connected ? 'OFFLINE' : sim.state.toUpperCase()}
      </span>
      <span style={{color:C.textBright,fontFamily:"'Orbitron',monospace",fontSize:'13px'}}>t={(sim.tNs / 1e6).toFixed(3)} ms</span>
      {!running && <StopReason reason={sim.reason} />}
      <span style={{flex:1}} />
      <button style={btn(running)} onClick={() => send('run')} disabled={running}>▶ RUN</button>
      <button style={btn(!running, C.amber)} onClick={() => send('pause')} disabled={!running}>⏸ PAUSE</button>
      <input type="number" min={1} value={stepN} onChange={e => setStepN(Math.max(1, +e.target.value || 1))}
             style={{...inp,width:'46px'}} title={`${CPU} instructions per step`} />
      <button style={btn(false)} disabled={running} onClick={() => send(`step ${cpu} ${stepN}`)}
              title={`Run ${stepN} ${CPU} instruction${stepN > 1 ? 's' : ''}, then pause`}>STEP {CPU}</button>
      <input value={untilMs} onChange={e => setUntil(e.target.value)} placeholder="ms" style={{...inp,width:'40px'}}
             onKeyDown={e => e.key === 'Enter' && untilMs && send(`until ${untilMs}`)} />
      <button style={btn(false)} disabled={running || !untilMs} onClick={() => send(`until ${untilMs}`)}
              title="Run until this sim time (ms), then pause">RUN TO</button>
      <button style={btn(false, C.red)} onClick={restart} title="Kill the sim and start again at t=0">↺ RESTART</button>
    </div>
  );
}

// ── ROM images: what each EPROM holds, and loading another .mem ──
function RomRow({ url, setupsVer, roms, asmSrc, paused, loadRom, comparing, toggleCompare }) {
  const [reset, setReset] = useState(true);
  const pick = { dme: useRef(null), klr: useRef(null) };
  // Image setups (named DME + KLR pairs, GET <bridge>/setups): the
  // developer scripts' three and the ones saved from a list of edits
  const [setups, setSetups] = useState([]);
  const [setupSel, setSetupSel] = useState('');
  const [setupErr, setSetupErr] = useState(null);
  const loadSetups = () => url && fetch(`${url}/setups`).then(r => r.ok ? r.json() : []).catch(() => []).then(setSetups);
  useEffect(() => { loadSetups(); }, [url, roms?.dme, roms?.klr, setupsVer]);   // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = setups.find(x => x.name === setupSel);
  const setupCall = async (path, method) => {
    setSetupErr(null);
    try {
      const r = await fetch(`${url}${path}`, { method });
      if (!r.ok) setSetupErr((await r.text()) || `HTTP ${r.status}`);
      return r.ok;
    } catch { setSetupErr(`can't reach the simulator bridge at ${url}`); return false; }
  };
  return (
    <div style={{...panel,display:'flex',gap:'14px',alignItems:'center',flexWrap:'wrap',fontSize:'10px',padding:'5px 10px'}}>
      <span style={{...title,marginBottom:0}}>ROM IMAGES</span>
      {['dme', 'klr'].map(cpu => (
        <span key={cpu} style={{display:'inline-flex',gap:'6px',alignItems:'center'}}>
          <span style={{color:C.textDim}}>{cpu.toUpperCase()}</span>
          <RomName path={roms?.[cpu]} cpu={cpu} bridge={url} style={{color:C.textBright}} title={roms?.[cpu] ?? ''} />
          {asmSrc?.[cpu] && (asmSrc[cpu].match === 'none'
            ? <span style={{color:'#ccaa44'}} title="This image doesn't match any disassembly workbook, so the debugger listing is the default one and may not line up with the code">ASM: no workbook</span>
            : <span style={{color:C.textDim}} title={`Debugger listing from ${cpu}/disassemble/${asmSrc[cpu].workbook} (image matched by ${asmSrc[cpu].match})`}>ASM: {asmSrc[cpu].workbook}</span>)}
          <input ref={pick[cpu]} type="file" accept=".mem,.bin,.hex,.ihx" style={{display:'none'}}
                 onChange={e => { const f = e.target.files[0]; e.target.value = ''; loadRom(cpu, f, reset); }} />
          <button style={{...btn(paused), cursor: paused ? 'pointer' : 'not-allowed'}} disabled={!paused} onClick={() => pick[cpu].current.click()}
                  title={paused ? `Load a ROM image (.mem, .bin or Intel HEX) into the ${cpu.toUpperCase()} EPROM` : 'Pause the simulation to load a ROM'}>
            LOAD .mem
          </button>
          {(() => {
            // Only for code edits not saved yet: a saved image's .bin is on
            // disk with it (bin_images/<cpu>/edited/<name>/), and an unedited
            // image's is the one it was loaded from
            const unsaved = !!roms?.[cpu] && asmSrc?.[cpu]?.patched > 0 && !asmSrc[cpu].saved;
            return (
              <button style={{...btn(false), cursor: unsaved ? 'pointer' : 'not-allowed', opacity: unsaved ? 1 : 0.4}}
                      disabled={!unsaved} onClick={e => downloadBin(e, url, cpu, null)}
                      title={unsaved
                        ? `Download the image in the ${cpu.toUpperCase()} EPROM (edits included) as a raw .bin for an EPROM programmer`
                        : asmSrc?.[cpu]?.saved
                          ? `These edits are saved as ${asmSrc[cpu].saved} (with its .bin, in bin_images/${cpu}/edited/)`
                          : `No unsaved code edits in the ${cpu.toUpperCase()} EPROM`}>⬇ .bin</button>
            );
          })()}
        </span>
      ))}
      <label style={{color:C.textDim,cursor:'pointer'}}
             title="On: restart the sim at t=0 on the new image (the other EPROM keeps its image). Off: swap the image in place; the CPU keeps its PC and RAM.">
        <input type="checkbox" checked={reset} onChange={e => setReset(e.target.checked)} /> RESTART AFTER LOAD
      </label>
      {!paused && <span style={{color:'#779977'}}>pause to load a ROM</span>}
      <span style={{display:'inline-flex',gap:'6px',alignItems:'center'}}
            title="A setup is a named DME + KLR pair. Save one from the list of edits (click a red (modified) image name) after SAVE AS">
        <span style={{color:C.textDim}}>SETUP</span>
        <select value={setupSel} onChange={e => setSetupSel(e.target.value)} onFocus={loadSetups} style={{...inp,maxWidth:'220px'}}>
          <option value="">pick…</option>
          {setups.map(x => <option key={x.name} value={x.name} disabled={!x.ok}>
            {x.name}{x.builtin ? '' : ' (saved)'} · {x.dme} + {x.klr}{x.ok ? '' : ' (image missing)'}</option>)}
        </select>
        <button style={{...btn(false), cursor: paused && chosen ? 'pointer' : 'not-allowed'}} disabled={!paused || !chosen?.ok}
                onClick={() => setupCall(`/setups/${encodeURIComponent(setupSel)}/load${reset ? '?reset=1' : ''}`, 'POST')}
                title={chosen ? `Load ${chosen.dme} into the DME and ${chosen.klr} into the KLR${reset ? ', then restart at t=0' : ' in place'}` : 'Pick a setup'}>LOAD SETUP</button>
        {chosen && !chosen.builtin && (
          <button style={btn(false, C.red)} title={`Delete the setup ${chosen.name} (the images stay)`}
                  onClick={async () => confirm(`Delete the setup ${chosen.name}? The images stay.`)
                    && await setupCall(`/setups/${encodeURIComponent(chosen.name)}`, 'DELETE') && (setSetupSel(''), loadSetups())}>✕</button>
        )}
        {setupErr && <span style={{color:C.red}}>{setupErr}</span>}
      </span>
      <span style={{flex:1}} />
      <button style={btn(comparing, C.blue)} onClick={toggleCompare}
              title="What differs between two DME or two KLR images: maps and tables decoded side by side, and the code that differs with its disassembly">
        COMPARE IMAGES
      </button>
    </div>
  );
}

// ── Engine values: latest DS snapshot, plus a chart per metric ──
const hexv = v => v == null ? '--' : `0x${hx(v)}`;
const METRICS = [
  { k:'rpm',    label:'RPM',          col:'#66ffaa', fmt: v => v ?? '--' },
  { k:'inj',    label:'INJ PULSE',    col:'#aaffaa', unit:'ms', step:true, overlay:'injHeldMs', warn: p => p?.injHeld || p?.injDuty >= 100,
    fmt: (v, p) => p?.revCut ? 'REV LIMIT' : p?.fuelCut ? 'CUT' : p?.injHeld ? (v == null ? 'HELD OPEN' : `HELD OPEN ${v.toFixed(2)} ms (1 rev)`) : v == null ? '--'
      : `${v.toFixed(2)} ms${p?.injDuty >= 100 ? ' HELD OPEN' : p?.injDuty != null ? ` ${p.injDuty}%` : ''}` },
  { k:'fuel',   label:'FUEL CMD 4A:4B', col:'#77bb77', unit:'ms', overlay:'fuelCutMs', warn: p => p?.injOver || p?.fuelCut,
    fmt: (v, p) => v == null ? '--' : `${v.toFixed(3)} ms${p?.revCut ? ' REV LIMIT (not injected)' : p?.fuelCut ? ' CUT (not injected)' : p?.injOver ? ' > 1 REV' : ''}` },
  { k:'afm',    label:'AFM RAW',      col:'#44cccc', hex:true, fmt: hexv },
  { k:'tps',    label:'TPS',          col:'#88ccff', hex:true, fmt: hexv },
  { k:'load',   label:'LOAD',         col:'#ffcc66', hex:true, fmt: hexv },
  { k:'boost',  label:'BOOST',        col:'#ffaa00', unit:'psi', fmt: fmtBoost },
  { k:'dmeIgn', label:'DME SPARK INTERVAL', col:'#ff8888', unit:'ms', step:true, fmt: v => v == null ? '--' : `${v.toFixed(2)} ms` },
  { k:'klrIgn', label:'KLR IGN PULSE', col:'#ff66cc', unit:'ms', step:true, fmt: v => v == null ? '--' : `${v.toFixed(2)} ms` },
  { k:'ovl',    label:'OVERLOAD TIMER (58h)', col:'#ff5577', hex:true, step:true, warn: p => p?.ovlLock,
    fmt: (v, p) => v == null ? '--' : `${hx(v)}${p?.ovlLock ? ' LOCKOUT' : p?.ovlPre ? ' pre-timer' : ''}` },
];

// A metric as a tile (as on the log's DME OVERVIEW): the value, its unit
// or state under it, and the run's min / max
const ms = (v, n) => v == null ? '--' : v.toFixed(n);
const hexTile = v => ({ val: hx(v), unit: v == null ? 'hex' : `hex · ${v}d` });
const TILE = {
  rpm:   v => ({ val: v ?? '--', unit: 'RPM' }),
  inj:   (v, p) => ({
    val: p?.revCut ? 'REV LIMIT' : p?.fuelCut ? 'CUT' : v == null ? (p?.injHeld ? 'HELD' : '--') : v.toFixed(2),
    unit: p?.injHeld ? (v == null ? 'held open' : 'ms · HELD OPEN (1 rev)') : p?.injDuty >= 100 ? 'ms · HELD OPEN'
        : p?.injDuty != null ? `ms · ${p.injDuty}% duty` : 'ms' }),
  fuel:  (v, p) => ({ val: ms(v, 3),
    unit: `ms${p?.revCut ? ' · REV LIMIT (not injected)' : p?.fuelCut ? ' · CUT (not injected)' : p?.injOver ? ' · > 1 REV' : ''}` }),
  afm:   hexTile, tps: hexTile, load: hexTile,
  boost: v => { const [val, unit] = boostParts(v); return { val, unit: unit || 'psi / inHg' }; },
  dmeIgn: v => ({ val: ms(v, 2), unit: 'ms' }),
  klrIgn: v => ({ val: ms(v, 2), unit: 'ms' }),
  ovl:   (v, p) => ({ val: hx(v), unit: p?.ovlLock ? 'LOCKOUT · fuel cut' : p?.ovlPre ? 'pre-timer running' : 'idle' }),
};
const MM_FMT = { rpm: v => v, afm: hx, tps: hx, load: hx, boost: v => boostParts(v)[0], fuel: v => v.toFixed(3), ovl: hx };

function StatTile({ m, last, mm }) {
  const { val, unit } = TILE[m.k](last?.[m.k], last);
  const warn = m.warn?.(last);
  const f = MM_FMT[m.k] ?? (v => v.toFixed(2));
  return (
    <div style={{background:C.panelBg2,border:`1px solid ${warn ? C.red : C.border}`,borderRadius:'2px',padding:'8px 6px',textAlign:'center',minWidth:0}}>
      <div style={{color:C.textDim,fontSize:'9px',letterSpacing:'0.12em',textTransform:'uppercase'}}>{m.label}</div>
      <div style={{color: warn ? C.red : m.col,fontFamily:"'Orbitron','Courier New',monospace",fontSize:'17px',lineHeight:'1.2',margin:'4px 0',
                   textShadow:`0 0 6px ${warn ? C.red : m.col}44`,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{val}</div>
      <div style={{color: warn ? C.red : C.textDim,fontSize:'9px'}}>{unit}</div>
      {mm && (
        <div style={{display:'flex',justifyContent:'space-between',marginTop:'5px',paddingTop:'4px',borderTop:`1px solid ${C.border}`,fontSize:'9px'}}>
          <span style={{color:'#33aaff'}}>▼{f(mm[0])}</span>
          <span style={{color:C.textDim,fontSize:'8px'}}>min/max</span>
          <span style={{color:'#ff8844'}}>▲{f(mm[1])}</span>
        </div>
      )}
    </div>
  );
}

// Memoized: the live view re-renders on every sim tick, but a chart only
// needs redrawing when its series changes (recharts is the costly part).
const MetricChart = memo(function MetricChart({ m, series, t0, t1, range, zoom }) {
  const data = useMemo(() => thin(inRange(series, range), m.overlay ? [m.k, m.overlay] : m.k, 800), [series, m, range]);
  return (
    <div style={{background:C.panelBg2,border:`1px solid ${C.border}`,padding:'3px 4px 0'}}>
      <div style={{color:m.col,fontSize:'9px',letterSpacing:'0.12em'}}>{m.label}{m.unit ? ` (${m.unit})` : ''}</div>
      <ZoomBox zoom={zoom}><ResponsiveContainer width="100%" height={86}>
        <LineChart data={data} margin={{top:4,right:8,bottom:0,left:0}} syncId="liveEngine" syncMethod={syncNearest}
                   {...zoomHandlers(zoom)}>
          <CartesianGrid stroke="#123312" strokeDasharray="2 4" />
          <XAxis dataKey="t" type="number" domain={range ?? [t0, t1]} allowDataOverflow tick={{fill:'#557755',fontSize:8}}
                 tickFormatter={v => `${(v / 1000).toFixed(1)}s`} />
          <YAxis width={40} domain={['auto','auto']} tick={{fill:'#557755',fontSize:8}}
                 tickFormatter={v => m.hex ? hx(v) : v} />
          <Tooltip contentStyle={{background:'#030803',border:`1px solid ${C.border}`,fontSize:10}}
                   labelFormatter={v => `${v} ms`} formatter={(v, _n, item) => [m.fmt(v, item?.payload), m.label]} />
          <Line dataKey={m.k} stroke={m.col} dot={false} isAnimationActive={false}
                type={m.step ? 'stepAfter' : 'linear'} connectNulls />
          {m.overlay && (
            <Line dataKey={m.overlay} stroke={C.red} strokeWidth={2} dot={false} isAnimationActive={false}
                  type={m.step ? 'stepAfter' : 'linear'} legendType="none" tooltipType="none" />
          )}
          <DragArea zoom={zoom} fill={C.textBright} />
        </LineChart>
      </ResponsiveContainer></ZoomBox>
    </div>
  );
});

function EngineRow({ series }) {
  const [charts, setCharts] = useState(true);
  // Zoomed, the charts hold that window while the run goes on
  const [range, setRange] = useState(null);
  const last = series[series.length - 1];
  const t0 = series[0]?.t ?? 0, t1 = last?.t ?? 1;
  const full = useMemo(() => [t0, t1], [t0, t1]);
  const zoom = useZoom(range, setRange, full);
  // Each metric's min / max over the run (as the log's overview tiles show)
  const minmax = useMemo(() => {
    const out = {};
    for (const m of METRICS) {
      let lo = Infinity, hi = -Infinity;
      for (const p of series) {
        const v = p[m.k];
        if (v == null || isNaN(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      out[m.k] = lo === Infinity ? null : [lo, hi];
    }
    return out;
  }, [series]);
  return (
    <div style={{...panel,display:'flex',flexDirection:'column',gap:'6px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:'8px'}}>
        <span style={title}>LIVE STATS</span>
        <span style={{display:'inline-flex',gap:'8px',alignItems:'baseline'}}>
          <span style={{color:'#779977',fontSize:'9px'}}>
            {last ? `latest snapshot ${last.t} ms` : 'no snapshot yet'}
          </span>
          <button style={btn(charts)} onClick={() => setCharts(c => !c)}>CHARTS</button>
        </span>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:'6px'}}>
        {METRICS.map(m => <StatTile key={m.k} m={m} last={last} mm={minmax[m.k]} />)}
      </div>
      {charts && series.length > 1 && (
        <ZoomBar zoom={zoom} range={range} full={full} btn={btn(false)} color={C.textBright} dim='#779977' />
      )}
      {charts && series.length > 1 && (
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',gap:'6px'}}>
          {METRICS.map(m => (
            <MetricChart key={m.k} m={m} series={series} t0={t0} t1={t1} range={range} zoom={zoom} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Inputs ──────────────────────────────────────────────────────
function InputsPanel({ inputs, send }) {
  const [draft, setDraft] = useState({});
  // a regression-test run reports its inputs as 'script' (or the value now)
  const scripted = Object.values(inputs).includes('script');
  const commit = (k, v) => {
    setDraft(d => { const n = { ...d }; delete n[k]; return n; });
    send(`set ${k} ${v}`);
  };
  return (
    <div style={panel}>
      <div style={title}>SIM INPUTS</div>
      {scripted && <div style={{color:'#cc88ff',fontSize:'9px',marginBottom:'6px'}}>
        regression test: its script drives these, so they show what the engine reads now and can't be changed</div>}
      {INPUTS.map(d => {
        const cur = inputs[d.k];
        const isAuto = cur === 'auto';
        const isScript = cur === 'script';
        const val = draft[d.k] ?? (isAuto || isScript ? null : cur);
        const max = d.max ?? 255, min = d.min ?? 0;
        return (
          <div key={d.k} style={{marginBottom:'6px'}}>
            <div style={{display:'flex',gap:'6px',alignItems:'center',fontSize:'10px'}}>
              <span style={{color:C.textDim,width:'118px'}}>{d.label}</span>
              <span style={{color:isAuto ? C.blue : scripted ? '#cc88ff' : C.textBright,minWidth:'70px'}}>
                {isScript ? 'SCRIPT'
                  : isAuto && draft[d.k] == null ? 'AUTO'
                  : val == null ? '--'
                  : d.dec ? val
                  : d.positions ? (d.positions.includes(val)
                      ? `${d.names ? d.names[d.positions.indexOf(val)] : `pos ${d.positions.indexOf(val)}`} (0x${hx(val)})`
                      : `0x${hx(val)}`)
                  : `0x${hx(val)} (${val})${d.volts ? ` ${(val * 0.05263 + 2.132).toFixed(1)}V` : ''}`}
              </span>
              {d.auto && !scripted && (
                <label style={{color:C.blue,cursor:'pointer',marginLeft:'auto'}}>
                  <input type="checkbox" checked={isAuto}
                         onChange={e => send(`set ${d.k} ${e.target.checked ? 'auto' : (val ?? d.pin)}`)} /> auto
                </label>
              )}
            </div>
            {d.positions ? (
              <div style={{display:'flex',gap:'2px',margin:'2px 0'}}>
                {d.positions.map((raw, i) => (
                  <label key={i} title={typeof raw === 'number' ? `0x${hx(raw)}` : raw}
                         style={{flex:1,textAlign:'center',fontSize:'10px',cursor:'pointer',padding:'2px 0',
                                 border:`1px solid ${cur === raw ? C.textBright : C.border}`,
                                 background: cur === raw ? '#0d4a0d' : C.panelBg2,
                                 color: cur === raw ? C.textBright : C.textDim}}>
                    <input type="radio" name={d.k} checked={cur === raw} disabled={cur == null || scripted}
                           onChange={() => commit(d.k, raw)} style={{display:'none'}} />
                    {d.names ? d.names[i] : i}
                  </label>
                ))}
              </div>
            ) : (
            <input type="range" min={min} max={max} step={d.step ?? 1} value={val ?? min}
                   disabled={cur == null || scripted}
                   onChange={e => setDraft(dr => ({ ...dr, [d.k]: +e.target.value }))}
                   onPointerUp={e => commit(d.k, e.target.value)}
                   onKeyUp={e => commit(d.k, e.target.value)}
                   style={{width:'100%',accentColor: isAuto ? C.blue : '#00cc66',opacity: isAuto || scripted ? 0.5 : 1}} />
            )}
            {d.hint && !scripted && <div style={{color:'#779977',fontSize:'8px'}}>{d.hint}</div>}
            {(d.k === 'cat' || d.k === 'o2') && inputs.cat === 1 &&
              <div style={{color:C.red,fontSize:'9px'}}>
                NO CAT: O2 disconnected (both O2 pins held at 0, as in o2_disconnected)</div>}
          </div>
        );
      })}
      <KnockRow inputs={inputs} send={send} scripted={scripted} />
    </div>
  );
}

// Knock on the KLR's knock sensor: on the next N crank revolutions
// (knock_revs, counted down by the sim) or on every one until STOP (knock 1)
function KnockRow({ inputs, send, scripted }) {
  const [revs, setRevs] = useState(10);
  if (inputs.knock == null) return null;
  const left = inputs.knock_revs;
  const cont = inputs.knock === 1;
  const on = cont || left > 0;
  const can = !scripted;
  const stop = () => { send('set knock 0'); if (left != null) send('set knock_revs 0'); };
  return (
    <div style={{marginBottom:'6px'}}>
      <div style={{display:'flex',gap:'6px',alignItems:'center',fontSize:'10px'}}>
        <span style={{color:C.textDim,width:'118px'}}>KNOCK (KLR)</span>
        <span style={{color: on ? C.red : scripted ? '#cc88ff' : C.textBright,minWidth:'70px'}}>
          {scripted ? 'SCRIPT' : cont ? 'CONTINUOUS' : left > 0 ? `${left} rev${left === 1 ? '' : 's'} left` : 'off'}
        </span>
      </div>
      <div style={{display:'flex',gap:'4px',margin:'2px 0',alignItems:'center'}}>
        {left != null && <>
          <input type="number" min={1} max={9999} value={revs} disabled={!can} style={{...inp,width:'40px'}}
                 onChange={e => setRevs(Math.max(1, Math.min(9999, +e.target.value || 1)))} />
          <span style={{color:C.textDim,fontSize:'10px'}}>revs</span>
          <button style={{...btn(false, C.red),padding:'4px 7px'}} disabled={!can} onClick={() => send(`set knock_revs ${revs}`)}
                  title={`Knock on the next ${revs} crank revolutions (one knock event per revolution, 32 teeth after TDC)`}>
            KNOCK
          </button>
        </>}
        <button style={{...btn(cont, C.red),padding:'4px 7px'}} disabled={!can} onClick={() => send('set knock 1')}
                title="Knock on every revolution until STOP">CONTINUOUS</button>
        <button style={{...btn(false),padding:'4px 7px'}} disabled={!can || !on} onClick={stop}>STOP</button>
      </div>
      {!scripted && <div style={{color:'#779977',fontSize:'8px'}}>
        the TEST_KNOCK_PULSE drop on the KLR knock sensor, once per revolution; the engine has to be turning</div>}
    </div>
  );
}

// ── Disassembly ─────────────────────────────────────────────────
// The stack, listing and trace panes keep a fixed height and scroll inside,
// so the debugger doesn't jump around as their contents change.
const ROW_H     = 15;    // px per listing / trace row
const CODE_ROWS = 32;    // height of the "no listing" placeholder, in rows
const WINDOW    = 64;    // rows rendered above and below the centre line (scrollable)
const STACK_H   = 140;   // px

// Nearest row at or before an address (pc can sit mid-instruction while running)
function rowFor(listing, a) {
  if (a == null || !listing.length) return 0;
  let lo = 0, hi = listing.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (listing[mid].a <= a) lo = mid; else hi = mid - 1; }
  return lo;
}

// The last jump / branch / interrupt that led to the current PC
function CameFrom({ cpu, trace, listing, onJump }) {
  const cf = useMemo(() => cameFrom(cpu, trace, listing), [cpu, trace, listing]);
  const line = {fontSize:'10px',lineHeight:'14px',height:'14px',marginBottom:'4px',textAlign:'left',color:C.textDim,
                whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'};
  if (!cf) return <div style={line} />;   // keeps its line so the panes below don't move
  const w = cpu === 'dme' ? 4 : 3;
  return (
    <div style={line}>
      {cf.kind === 'interrupt' ? 'INTERRUPT AFTER ' : 'CAME FROM '}
      <span style={{color:C.blue,cursor:'pointer'}} title="Show in listing" onClick={() => onJump(cf.from)}>
        {hx(cf.from, w)}{cf.ins ? `  ${cf.ins.instr} ${cf.ins.ops}` : ''}
      </span>
      {' → '}{hx(cf.to, w)}
      {cf.ago > 0 && <span>  ({cf.ago} instruction{cf.ago > 1 ? 's' : ''} ago)</span>}
    </div>
  );
}

// Stack memory dump with decoded return addresses (top of stack first)
function StackView({ cpu, ram, regs, listing, running, onJump }) {
  const st = useMemo(() => decodeStack(cpu, ram, regs, listing), [cpu, ram, regs, listing]);
  const box = {fontSize:'10px',marginBottom:'6px',border:`1px solid ${C.border}`,background:C.panelBg2,
               padding:'3px 6px',textAlign:'left',lineHeight:'14px',height:`${STACK_H}px`,boxSizing:'border-box',
               overflowY:'auto',flex:'none'};
  if (!st) return <div style={{...box,color:'#557755'}}>STACK  no memory snapshot yet</div>;
  const { lo, hi } = STACK[cpu];
  const w = cpu === 'dme' ? 4 : 3;
  const addrs = [];
  for (let a = lo; a <= hi; a++) addrs.push(a);
  const top = cpu === 'dme' ? st.sp : lo + 2 * ((st.sp - 1) & 7) + 1;
  const depth = cpu === 'dme' ? `${Math.max(0, st.sp - lo + 1)} bytes` : '(3-bit, wraps after 8 levels)';
  return (
    <div style={{...box,opacity: running ? 0.6 : 1}}>
      <div style={{color:C.textDim,marginBottom:'2px'}}>
        STACK {hx(lo)}–{hx(hi)}h  SP={cpu === 'dme' ? `${hx(st.sp)}h` : st.sp}  {depth}
        {cpu === 'dme' && (st.sp < lo - 1 || st.sp > hi) && <span style={{color:C.red}}>  SP OUTSIDE STACK AREA</span>}
      </div>
      <div style={{display:'flex',flexWrap:'wrap',gap:'0 5px',fontFamily:'inherit'}}>
        {addrs.map(a => (
          <span key={a} title={`${hx(a)}h`}
                style={{color: st.used.has(a) ? C.textBright : '#446644',
                        outline: a === top ? `1px solid ${C.amber}` : 'none'}}>
            {hx(ram[a])}
          </span>
        ))}
      </div>
      {st.frames.length > 0 && (
        <div style={{marginTop:'3px',display:'flex',flexDirection:'column',gap:'1px'}}>
          {st.frames.map((f, i) => f.kind === 'data' ? (
            <span key={i} style={{color:'#779977'}}>{hx(f.at)}h  data {hx(f.val)}</span>
          ) : f.kind === 'push' ? (
            <span key={i} style={{cursor:'pointer'}} title="Show the PUSH in listing" onClick={() => onJump(f.src)}>
              <span style={{color:'#779977'}}>{hx(f.at)}h  </span>
              <span style={{color:C.textDim}}>push {f.what ?? '?'} = {hx(f.val)}</span>
              <span style={{color:'#779977'}}>  at {hx(f.src, w)}</span>
            </span>
          ) : (
            <span key={i} style={{cursor:'pointer'}} title="Show in listing" onClick={() => onJump(f.ret)}>
              <span style={{color:'#779977'}}>{hx(f.at)}h  </span>
              <span style={{color: f.kind === 'call' ? C.blue : f.kind === 'int' ? '#ccaaff' : f.kind === 'old' ? '#557755' : C.amber}}>
                {f.kind === 'call' ? 'ret' : f.kind === 'int' ? 'reti' : f.kind} → {hx(f.ret, w)}
              </span>
              {f.routine && <span style={{color: f.kind === 'old' ? '#557755' : C.amber}}>  in {f.routine}</span>}
              {f.psw != null && <span style={{color:'#779977'}}>  psw {hx(f.psw, 1)}x</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// A breakpoint's memory condition, {mem, bit, op, val}: as the sim command
// takes it ("37 == 15", "21.0 != 1") and as shown ("37h PRPM == 15h")
const condArg = k => `${hx(k.mem)}${k.bit != null ? `.${k.bit}` : ''} ${k.op} ${hx(k.val)}`;
const condText = (cpu, k) => {
  const n = memName(cpu, k.mem, k.bit);
  return `${hx(k.mem)}h${k.bit != null ? `.${k.bit}` : ''}${n ? ` ${n}` : ''} ${k.op} ${k.bit != null ? k.val : `${hx(k.val)}h`}`;
};
const condNow = (k, ram) => {
  const v = ram?.[k.mem];
  if (v == null) return null;
  const x = k.bit != null ? (v >> k.bit) & 1 : v;
  return { x, ok: k.op === '==' ? x === k.val : k.op === '!=' ? x !== k.val : k.op === '<' ? x < k.val : x > k.val };
};
// ── Write watch ──────────────────────────────────────────────────
// The sim logs every change to a RAM byte from reset (or a snapshot load)
// with the address of the instruction that made it, whether or not a watch
// is set, so the boot code's writes can be looked up afterwards. A watch
// shows a byte's (or bit's) history here; ticking STOP also pauses the
// sim right after the next instruction that changes it.
// A watch stop reason, "watch dme 37 00->05 by 1A2B" / "watch dme 21.3 0->1 by 1A2B"
const watchHitOf = reason => {
  const m = /^watch (dme|klr) ([0-9A-F]{2})(?:\.([0-7]))? ([0-9A-F]+)->([0-9A-F]+) by ([0-9A-F]+)/.exec(reason ?? '');
  return m && { cpu: m[1], mem: parseInt(m[2], 16), bit: m[3] != null ? +m[3] : null, old: m[4], nw: m[5], by: m[6] };
};
const memLoc = (cpu, mem, bit) => {
  const n = memName(cpu, mem, bit);
  return `${cpu === 'dme' ? 'iram' : 'ram'}[${hx(mem)}h]${bit != null ? `.${bit}` : ''}${n ? ` ${n}` : ''}`;
};
const watchText = w => `${memLoc(w.cpu, w.mem, w.bit)} ${w.bit != null ? `${w.old}→${w.nw}` : `${w.old}h→${w.nw}h`}`;
// The routine an address is in: "label" or "label+3"
const routineOf = (listing, a) => {
  if (!listing?.length) return '';
  for (let i = rowFor(listing, a); i >= 0; i--) {
    if (listing[i].label) return listing[i].a === a ? listing[i].label : `${listing[i].label}+${(a - listing[i].a).toString(16).toUpperCase()}`;
    if (listing[i].a < a - 0x400) break;
  }
  return '';
};
const tms = t => t == null ? '' : t < 10 ? t.toFixed(4) : t.toFixed(3);
const WATCH_POLL_MS = 2000;   // while running, how often the watched bytes' history is fetched

function WatchPanel({ cpu, watches, watchOk, writes = {}, writers, send, listing, ram, running, connected, onJump }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(null);       // key whose history is shown
  const [showAll, setShowAll] = useState(false);
  const [allQ, setAllQ] = useState('');
  const list = watches ?? [];
  const keys = list.map(w => w.key).join(' ');
  // While running, ask for the watched bytes' history now and then (a stop sends it anyway)
  useEffect(() => {
    if (!running || !keys) return;
    const id = setInterval(() => send(`writes ${cpu} ${keys}`), WATCH_POLL_MS);
    return () => clearInterval(id);
  }, [running, keys, cpu, send]);
  useEffect(() => { if (showAll && !running) send(`writes ${cpu} all`); }, [showAll, running, cpu, send]);
  if (!connected) return null;
  if (!watchOk) return (
    <div style={{fontSize:'10px',color:C.textDim,marginBottom:'4px'}}>
      WRITE WATCH <span style={{color:'#779977'}}>· this simulator build has no write log: run ./build_live.sh, then restart the bridge</span>
    </div>
  );
  const add = loc => {
    if (!loc) return;
    send(`watch add ${cpu} ${hx(loc.mem)}${loc.bit != null ? `.${loc.bit}` : ''} log`);
    setAdding(false); setText(''); setOpen(hx(loc.mem) + (loc.bit != null ? `.${loc.bit}` : ''));
  };
  const typed = () => {
    const m = /^(?:0x)?([0-9a-f]{1,2})h?(?:\.([0-7]))?(?:\s|$)/i.exec(text.trim());
    if (m && parseInt(m[1], 16) <= 0x7F) add({ mem: parseInt(m[1], 16), bit: m[2] != null ? +m[2] : null });
  };
  const wcmd = (w, op, brk) => `watch ${op} ${cpu} ${w.key}${op === 'add' && !brk ? ' log' : ''}`;
  const pcLink = (pc, extra = '') => pc == null ? null : (
    <span style={{color:C.textBright,cursor:'pointer',textDecoration:'underline dotted'}} title={`Show ${hx(pc, cpu === 'dme' ? 4 : 3)} in the listing`}
          onClick={() => onJump(pc)}>
      {hx(pc, cpu === 'dme' ? 4 : 3)}{routineOf(listing, pc) && <span style={{color:C.amber}}> {routineOf(listing, pc)}</span>}{extra}
    </span>
  );
  const val = (v, bit) => bit != null ? `${v}` : `${hx(v)}h`;
  const chg = (c, bit) => c && <>{pcLink(c.pc)} <span style={{color:C.textDim}}>{val(c.old, bit)}→{val(c.nw, bit)} @ {tms(c.t)} ms{c.irq ? ' (+int entry)' : ''}</span></>;
  const allRows = (writers?.rows ?? []).filter(r => {
    const q = allQ.trim().toLowerCase();
    if (!q) return true;
    return hx(r.mem).toLowerCase().includes(q.replace(/h$/, '')) || memName(cpu, r.mem).toLowerCase().includes(q)
        || routineOf(listing, r.first).toLowerCase().includes(q) || routineOf(listing, r.last).toLowerCase().includes(q);
  });
  return (
    <div style={{fontSize:'10px',marginBottom:'4px'}}>
      <div style={{display:'flex',gap:'4px',flexWrap:'wrap',alignItems:'center'}}>
        <span style={{color:C.textDim}} title={'Who changed a RAM byte or bit, and when: the sim records every change from reset (t=0) or a snapshot load, with the instruction that made it, '
          + 'so writes made before the first sample (the boot code) can be looked up afterwards. Writing the value already there is not a change.\n'
          + 'Tick STOP to pause right after the next instruction that changes it.'}>WRITE WATCH</span>
        {list.length === 0 && !adding && <span style={{color:'#779977'}}>none · + WATCH to see who changed a byte or bit, from reset</span>}
        {list.map(w => {
          const d = writes[w.key];
          const now = ram?.[w.mem] != null ? (w.bit != null ? (ram[w.mem] >> w.bit) & 1 : ram[w.mem]) : null;
          const last = d?.hist?.[d.hist.length - 1];
          return (
            <span key={w.key} style={{display:'inline-flex',alignItems:'center',border:`1px solid ${open === w.key ? C.blue : C.border}`,background:C.panelBg2}}>
              <label style={{display:'inline-flex',alignItems:'center',gap:'2px',padding:'1px 4px',color: w.brk ? C.red : C.textDim,cursor:'pointer'}}
                     title="Stop right after an instruction changes it">
                <input type="checkbox" checked={w.brk} onChange={e => send(wcmd(w, 'add', e.target.checked))}
                       style={{margin:0,accentColor:C.red,cursor:'pointer'}} />STOP
              </label>
              <span style={{color:C.blue,padding:'1px 5px',cursor:'pointer',borderLeft:`1px solid ${C.border}`,textTransform:'none'}}
                    title="Show its history" onClick={() => setOpen(open === w.key ? null : w.key)}>
                {memLoc(cpu, w.mem, w.bit)}{now != null && !running ? ` = ${val(now, w.bit)}` : ''}
                <span style={{color:C.textDim}}> · {d ? `${d.n} change${d.n === 1 ? '' : 's'}` : '…'}</span>
                {last && <span style={{color:C.textDim}}> · last by <span style={{color:C.textBright}}>{hx(last.pc, cpu === 'dme' ? 4 : 3)}</span></span>}
                {open === w.key ? ' ▴' : ' ▾'}
              </span>
              <span style={{color:C.textDim,padding:'1px 5px',cursor:'pointer',borderLeft:`1px solid ${C.border}`}}
                    title="Remove watch" onClick={() => { send(wcmd(w, 'del')); if (open === w.key) setOpen(null); }}>✕</span>
            </span>
          );
        })}
        {adding ? (
          <>
            <MemSearch src={cpu} value={text} align="left" autoFocus onChange={setText}
                       onPick={m => add({ mem: m.addr, bit: m.bit ?? null })} onEnter={typed} style={{...inp,width:'170px'}}
                       placeholder="name or hex addr (21.3 for a bit)" />
            <button style={btn(false)} onClick={() => { setAdding(false); setText(''); }}>CANCEL</button>
          </>
        ) : <button style={btn(false, C.blue)} onClick={() => setAdding(true)}>+ WATCH</button>}
        <button style={btn(showAll, C.blue)} onClick={() => setShowAll(v => !v)}
                title="Every RAM byte that has changed since reset, with the first and the last instruction that changed it">WHO WROTE…</button>
      </div>
      {open && writes[open] && (() => {
        const d = writes[open];
        const rows = [...d.hist].reverse();
        return (
          <div style={{border:`1px solid ${C.border2}`,background:C.panelBg2,padding:'4px 6px',marginTop:'4px',maxHeight:'180px',overflowY:'auto'}}>
            <div style={{color:C.textDim,marginBottom:'3px',display:'flex',gap:'10px',flexWrap:'wrap'}}>
              <span style={{color:C.blue}}>{memLoc(cpu, d.mem, d.bit)}</span>
              <span>{d.n} change{d.n === 1 ? '' : 's'} since {d.since ? `${tms(d.since)} ms (snapshot load)` : 'reset'}</span>
              {d.first && <span>first: {chg(d.first, d.bit)}</span>}
              {d.bit != null && d.set && <span>last set: {chg(d.set, d.bit)}</span>}
              {d.bit != null && d.clr && <span>last clear: {chg(d.clr, d.bit)}</span>}
              {running && <span style={{color:'#557799'}}>(updates every {WATCH_POLL_MS / 1000} s while running)</span>}
            </div>
            {rows.length === 0 && <div style={{color:'#779977'}}>no change since {d.since ? 'the load' : 'reset'}{d.bit == null ? '' : ' (of this bit)'}</div>}
            {rows.map((c, i) => (
              <div key={i} style={{display:'flex',gap:'10px',whiteSpace:'nowrap'}}>
                <span style={{color:C.textDim,width:'11ch',textAlign:'right'}}>{tms(c.t)} ms</span>
                <span style={{color:C.textBright,width:'9ch'}}>{val(c.old, d.bit)} → {val(c.nw, d.bit)}</span>
                {pcLink(c.pc, c.irq ? <span style={{color:C.textDim}} title="An interrupt was entered right after this instruction: a stack byte may have been its push"> (+int entry)</span> : '')}
              </div>
            ))}
            {d.n > d.hist.length && d.bit == null && <div style={{color:C.textDim}}>… the sim keeps the last 64 changes of each byte; the first is above</div>}
          </div>
        );
      })()}
      {showAll && (
        <div style={{border:`1px solid ${C.border2}`,background:C.panelBg2,padding:'4px 6px',marginTop:'4px',maxHeight:'260px',overflowY:'auto'}}>
          <div style={{display:'flex',gap:'8px',alignItems:'center',marginBottom:'3px',color:C.textDim}}>
            <span>RAM bytes changed since {writers?.since ? `${tms(writers.since)} ms` : 'reset'}{writers ? ` · ${writers.rows.length}` : ''}</span>
            <input value={allQ} onChange={e => setAllQ(e.target.value)} placeholder="filter: addr, name or routine" style={{...inp,width:'170px'}} />
            <button style={btn(false)} onClick={() => send(`writes ${cpu} all`)} title="Fetch the list again">REFRESH</button>
            <button style={btn(false)} onClick={() => setShowAll(false)}>✕</button>
          </div>
          {!writers && <div style={{color:'#779977'}}>…</div>}
          {writers && (
            <table style={{borderCollapse:'collapse',width:'100%'}}>
              <thead><tr style={{color:C.textDim,textAlign:'left'}}>
                <th style={{fontWeight:'normal'}}>byte</th><th style={{fontWeight:'normal'}}>changes</th>
                <th style={{fontWeight:'normal'}}>first changed by</th><th style={{fontWeight:'normal'}}>last changed by</th><th />
              </tr></thead>
              <tbody>
                {allRows.map(r => (
                  <tr key={r.mem}>
                    <td style={{color:C.blue,whiteSpace:'nowrap'}}>{hx(r.mem)}h {memName(cpu, r.mem)}</td>
                    <td style={{color:C.textDim}}>{r.n}</td>
                    <td style={{whiteSpace:'nowrap'}}>{pcLink(r.first)} <span style={{color:C.textDim}}>@ {tms(r.firstT)} ms</span></td>
                    <td style={{whiteSpace:'nowrap'}}>{pcLink(r.last)} <span style={{color:C.textDim}}>@ {tms(r.lastT)} ms</span></td>
                    <td><span style={{color:C.blue,cursor:'pointer'}} title="Watch this byte" onClick={() => add({ mem: r.mem, bit: null })}>+watch</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

const CMP_OPS = ['==', '!=', '<', '>'];
// A conditional breakpoint's stop reason, "bp dme 024E if 37>14 (37=16)":
// the breakpoint, its condition and the value the sim compared
const bpHitOf = reason => {
  const m = /^bp (dme|klr) ([0-9A-F]+) if ([0-9A-F]{2})(?:\.([0-7]))?(==|!=|<|>)([0-9A-F]{1,2}) \(\S+=([0-9A-F]{1,2})\)/.exec(reason ?? '');
  return m && { cpu: m[1], pc: m[2], a: parseInt(m[2], 16), mem: parseInt(m[3], 16), bit: m[4] != null ? +m[4] : null,
                op: m[5], val: parseInt(m[6], 16), now: parseInt(m[7], 16) };
};
const hitText = h => {
  const n = memName(h.cpu, h.mem, h.bit);
  return `${h.cpu === 'dme' ? 'iram' : 'ram'}[${hx(h.mem)}h]${h.bit != null ? `.${h.bit}` : ''}${n ? ` ${n}` : ''} = ${
    h.bit != null ? h.now : `${hx(h.now)}h (${h.now})`}`;
};

// Editor for one breakpoint's memory condition: a memory location (search by
// name or hex address, as the Timeline tab's picker), a comparison and a value
function CondEditor({ cpu, addr, cond, ram, onSet, onClear, onCancel }) {
  const at = c => c ? `${hx(c.mem)}h${c.bit != null ? `.${c.bit}` : ''}${memName(cpu, c.mem, c.bit) ? ` ${memName(cpu, c.mem, c.bit)}` : ''}` : '';
  const [memText, setMemText] = useState(at(cond));
  const [op, setOp]   = useState(cond?.op ?? '==');
  const [val, setVal] = useState(cond ? hx(cond.val) : '');
  const [err, setErr] = useState('');
  // The location is the text's leading hex address ("37", "37h", "0x21.3")
  const loc = (() => {
    const m = /^(?:0x)?([0-9a-f]{1,2})h?(?:\.([0-7]))?(?:\s|$)/i.exec(memText.trim());
    return m ? { mem: parseInt(m[1], 16), bit: m[2] != null ? +m[2] : null } : null;
  })();
  const v = /^(?:0x)?([0-9a-f]{1,2})h?$/i.exec(val.trim());
  const value = v ? parseInt(v[1], 16) : null;
  const apply = () => {
    if (!loc || loc.mem > 0x7F) return setErr('pick a memory location (search by name, or type a hex address 00-7F, bit as 21.3)');
    if (value == null) return setErr('value must be a hex byte (00-FF)');
    if (loc.bit != null && value > 1) return setErr('a bit compares with 0 or 1');
    onSet({ ...loc, op, val: value });
  };
  const now = loc && ram?.[loc.mem] != null ? (loc.bit != null ? (ram[loc.mem] >> loc.bit) & 1 : ram[loc.mem]) : null;
  return (
    <div style={{display:'flex',gap:'4px',alignItems:'center',flexWrap:'wrap',fontSize:'10px',marginBottom:'4px',
                 padding:'4px',border:`1px solid ${C.border2}`,background:C.panelBg2}}>
      <span style={{color:C.red}}>● {hx(addr, cpu === 'dme' ? 4 : 3)}</span>
      <span style={{color:C.textDim}}>stops only if {cpu === 'dme' ? 'iram' : 'ram'}</span>
      <MemSearch src={cpu} value={memText} align="left" autoFocus
                 onChange={t => { setMemText(t); setErr(''); }}
                 onPick={m => { setMemText(at({ mem: m.addr, bit: m.bit ?? null })); setErr(''); }}
                 onEnter={apply} style={{...inp,width:'170px'}} />
      <select value={op} onChange={e => setOp(e.target.value)} style={inp} title="Unsigned comparison">
        {CMP_OPS.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <input value={val} onChange={e => { setVal(e.target.value); setErr(''); }} onKeyDown={e => e.key === 'Enter' && apply()}
             placeholder={loc?.bit != null ? '0/1' : 'hex'} style={{...inp,width:'36px'}} />
      {value != null && loc?.bit == null && <span style={{color:C.textDim}}>({value})</span>}
      <button style={btn(false, C.red)} onClick={apply}>SET</button>
      {cond && <button style={btn(false)} onClick={onClear} title="Stop every time this address runs">NO CONDITION</button>}
      <button style={btn(false)} onClick={onCancel}>CANCEL</button>
      {now != null && <span style={{color:C.blue}} title="From the latest snapshot">now {loc.bit != null ? now : `${hx(now)}h (${now})`}</span>}
      {err && <span style={{color:C.amber,width:'100%'}}>{err}</span>}
    </div>
  );
}

// Hex typed into a bytes cell: "02 10 08", "021008" or "2 10 8"; null if not hex
function parseBytes(text) {
  const t = text.trim();
  if (!t) return null;
  const toks = /\s/.test(t) ? t.split(/\s+/) : t.match(/.{1,2}/g);
  if (!toks.every(x => /^[0-9a-f]{1,2}$/i.test(x)) || toks.length > 16) return null;
  if (!/\s/.test(t) && t.length % 2) return null;
  return toks.map(x => parseInt(x, 16));
}

// The instruction bytes of a listing row. Click (while paused) to edit them:
// the bridge writes them into the image the sim runs and sends the listing
// decoded again. Edited rows show ✎, their changed bytes amber, and ↶ to put
// the bytes as loaded back.
function BytesCell({ cpu, r, editing, canEdit, onEdit, onWrite }) {
  const [text, setText] = useState(r.bytes);
  const [was, setWas] = useState(editing);
  if (editing !== was) { setWas(editing); if (editing) setText(r.bytes); }
  const parsed = editing ? parseBytes(text) : null;
  const changed = r.orig != null && r.orig.toLowerCase() !== r.bytes.toLowerCase();
  const stop = e => e.stopPropagation();
  if (editing) return (
    <span onClick={stop} style={{width:'13ch',flex:'none',display:'inline-flex'}}>
      <input autoFocus value={text} onChange={e => setText(e.target.value)} spellCheck={false}
             onFocus={e => e.target.select()}
             onKeyDown={e => {
               if (e.key === 'Escape') onEdit(false);
               else if (e.key === 'Enter' && parsed) onWrite(parsed);
             }}
             onBlur={() => onEdit(false)}
             title={`New bytes for ${hx(r.a, cpu === 'dme' ? 4 : 3)}, in hex. Enter writes them into the ${cpu.toUpperCase()} image (live), Esc cancels. More bytes than the instruction has run on over the next ones (up to 16)`}
             style={{...inp,width:'100%',padding:'0 2px',height:`${ROW_H - 2}px`,fontSize:'10.5px',
                     borderColor: parsed ? C.amber : C.red, color: parsed ? C.textBright : C.red}} />
    </span>
  );
  const orig = r.orig?.split(/\s+/) ?? [];
  return (
    <span style={{width:'13ch',flex:'none',overflow:'hidden',display:'inline-flex',gap:'3px',
                  cursor: canEdit ? 'text' : 'inherit'}}
          onClick={e => { if (canEdit) { stop(e); onEdit(true); } }}
          title={`${r.patched ? `Edited: decoded again from the edited bytes${changed ? `\nAs loaded: ${r.orig}` : ' (bytes as loaded)'}\n\n` : ''}`
                 + (canEdit ? 'Click to edit these bytes (opcode, operands, address)' : 'Pause the simulation to edit the bytes')}>
      {r.patched && <span style={{color:C.amber}}>✎</span>}
      <span style={{color:'#557755'}}>
        {r.bytes.split(/\s+/).map((b, i) => (
          <span key={i} style={{color: r.orig != null && orig[i]?.toLowerCase() !== b.toLowerCase() ? C.amber : undefined}}>{i ? ' ' : ''}{b}</span>
        ))}
      </span>
      {changed && canEdit && (
        <span style={{color:C.amber,cursor:'pointer'}} title={`Put back the bytes as loaded (${r.orig})`}
              onClick={e => { stop(e); onWrite(r.orig.split(/\s+/).map(b => parseInt(b, 16))); }}>↶</span>
      )}
    </span>
  );
}

// Operand symbols: names in an instruction's operand text (code labels, RAM
// and bit names, SFRs), skipping the CPU's own registers and #immediates
const OP_REGS = /^(a|ab|b|c|dptr|pc|r[0-7]|p[12]|f[01]|mb[01]|rb[01]|i|t|tcnt|tcnti|bus)$/i;
function opSymbols(ops) {
  const out = [];
  for (const m of (ops || '').matchAll(/(?<![#\w])[A-Za-z_]\w*/g))
    if (!OP_REGS.test(m[0])) out.push({ i: m.index, s: m[0] });
  return out;
}
const MARK = {background:'#ffcc00',color:'#000',padding:0};
// Text with every occurrence of q (lower case) marked
function marked(text, q) {
  const i = q && text ? text.toLowerCase().indexOf(q) : -1;
  if (i < 0) return text;
  return <>{text.slice(0, i)}<mark style={MARK}>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}
// An operand field: code labels are links to their row, and symbols
// matching the label search are marked
function OpsText({ ops, q, labelAt, onLabel }) {
  const syms = opSymbols(ops);
  if (!syms.length) return ops;
  const out = [];
  let at = 0;
  for (const { i, s } of syms) {
    if (i > at) out.push(ops.slice(at, i));
    const text = marked(s, q);
    out.push(labelAt?.has(s) && onLabel
      ? <span key={i} style={{color:'#7fb8e8',textDecoration:'underline dotted',cursor:'pointer'}}
              title={`Go to ${s} (${hx(labelAt.get(s), 4)})`}
              onClick={e => { e.stopPropagation(); onLabel(s); }}>{text}</span>
      : <span key={i}>{text}</span>);
    at = i + s.length;
  }
  if (at < ops.length) out.push(ops.slice(at));
  return out;
}

// Hex <-> decimal converter: type in either box and the other follows.
// A negative decimal shows as 8-bit (or 16-bit) two's complement.
function HexDec() {
  const [hex, setHex] = useState('');
  const [dec, setDec] = useState('');
  const onHex = t => {
    setHex(t);
    const m = t.trim().replace(/^0x/i, '').replace(/h$/i, '');
    const n = /^[0-9a-f]+$/i.test(m) ? parseInt(m, 16) : NaN;
    setDec(isNaN(n) ? '' : String(n));
  };
  const onDec = t => {
    setDec(t);
    const n = /^\s*-?\d+\s*$/.test(t) ? parseInt(t, 10) : NaN;
    if (isNaN(n) || n < -32768) return setHex('');
    setHex((n < 0 ? (n >= -128 ? n & 0xff : n & 0xffff) : n).toString(16).toUpperCase());
  };
  const n = dec !== '' ? parseInt(dec, 10) : NaN;
  const tip = isNaN(n) ? 'Hex / decimal converter: type in either box'
    : `${hex}h = ${n}` + (n >= 0 && n < 0x10000 ? `\nbinary ${n.toString(2).padStart(n < 0x100 ? 8 : 16, '0')}` : '')
      + (n >= 0x80 && n < 0x100 ? `\nsigned 8-bit ${n - 0x100}` : n >= 0x8000 && n < 0x10000 ? `\nsigned 16-bit ${n - 0x10000}` : '');
  const box = {...inp,width:'6ch',textAlign:'right'};
  return (
    <span style={{display:'inline-flex',gap:'3px',alignItems:'center',color:C.textDim,paddingLeft:'6px',borderLeft:`1px solid ${C.border}`}} title={tip}>
      <input value={hex} onChange={e => onHex(e.target.value)} placeholder="hex" style={box} spellCheck={false} />
      <span>h =</span>
      <input value={dec} onChange={e => onDec(e.target.value)} placeholder="dec" style={box} spellCheck={false} />
      {(hex || dec) && <span style={{cursor:'pointer'}} title="Clear" onClick={() => { setHex(''); setDec(''); }}>×</span>}
    </span>
  );
}

function AsmPanel({ cpu, name, listing, pc, bps, conds = {}, reason, trace, traceCtx, ram, regs, running, stopKey, send, hidden, onClose,
                    paused, edited = 0, patchRom, revertRom, rom, url, watches, watchOk, writes, writers, connected }) {
  const [showEdits, setShowEdits] = useState(false);
  const [jump, setJump]   = useState('');
  const [editAt, setEditAt] = useState(null);   // address whose bytes are being edited
  const canEdit = paused && !!patchRom;
  if (editAt != null && !canEdit) setEditAt(null);
  const [center, setCenter] = useState(null);   // address pinned by a jump, else follow pc

  // Every stop (breakpoint, step, pause) drops a GO pin so the view shows the PC
  const [lastStop, setLastStop] = useState(stopKey);
  if (stopKey !== lastStop) { setLastStop(stopKey); setCenter(null); setJump(''); }

  const routine = useMemo(() => {
    if (pc == null || !listing.length) return '';
    for (let i = rowFor(listing, pc); i >= 0; i--) if (listing[i].label) return listing[i].label;
    return '';
  }, [pc, listing]);

  // Disabled breakpoints are removed from the sim but stay listed here,
  // with their memory condition (offConds) for when they are enabled again
  const [disabled, setDisabled] = useState([]);
  const [offConds, setOffConds] = useState({});
  const [editing, setEditing] = useState(null);   // breakpoint whose condition is being edited
  const bpSet = useMemo(() => new Set(bps), [bps]);
  const offSet = useMemo(() => new Set(disabled.filter(a => !bpSet.has(a))), [disabled, bpSet]);
  const allBps = useMemo(() => [...new Set([...bps, ...offSet])].sort((x, y) => x - y), [bps, offSet]);
  const condOf = a => bpSet.has(a) ? conds[a] : offConds[a];
  const bpCmd = (op, a, k) => `bp ${op} ${cpu} ${hx(a, 4)}${op === 'add' && k ? ` if ${condArg(k)}` : ''}`;
  const setEnabled = (a, on) => {
    if (on) send(bpCmd('add', a, offConds[a]));
    else { send(bpCmd('del', a)); setOffConds(o => ({ ...o, [a]: conds[a] })); }
    setDisabled(d => on ? d.filter(x => x !== a) : [...d.filter(x => x !== a), a]);
  };
  const removeBp = a => {
    if (bpSet.has(a)) send(bpCmd('del', a));
    setDisabled(d => d.filter(x => x !== a));
    setOffConds(o => { const n = { ...o }; delete n[a]; return n; });
    if (editing === a) setEditing(null);
  };
  // Set (k) or clear (null) a breakpoint's condition
  const setCond = (a, k) => {
    if (bpSet.has(a)) send(bpCmd('add', a, k));
    else setOffConds(o => ({ ...o, [a]: k }));
    setEditing(null);
  };
  const recent = useMemo(() => new Set(trace.slice(-16)), [trace]);
  // A watch stop: the instruction that made the change (the PC is the next one)
  const wHit = !running ? watchHitOf(reason) : null;
  const writer = wHit && wHit.cpu === cpu ? parseInt(wHit.by, 16) : null;
  // Label / operand columns sized to the longest entry so nothing is cut off
  const colW = useMemo(() => ({
    label: Math.min(22, Math.max(10, ...listing.map(r => r.label.length))),
    ops:   Math.max(20, ...listing.map(r => r.ops.length)),
  }), [listing]);
  // Register context from the last time each traced address ran
  const lastCtx = useMemo(() => {
    const m = new Map();
    trace.forEach((a, i) => { if (traceCtx?.[i]) m.set(a, traceCtx[i]); });
    return m;
  }, [trace, traceCtx]);
  const c = rowFor(listing, center ?? pc);
  const first = Math.max(0, c - WINDOW);
  const rows = listing.slice(first, c + WINDOW);

  // Scroll the centre row (PC or a GO target) to the middle of the pane
  // whenever it moves; otherwise leave the user's scroll position alone.
  const codeRef = useRef(null);
  const centreRow = useRef(null);
  const scrollToCentre = () => {
    const row = codeRef.current?.children[centreRow.current];
    if (row) codeRef.current.scrollTop = row.offsetTop - (codeRef.current.clientHeight - ROW_H) / 2;
  };
  useLayoutEffect(() => { centreRow.current = c - first; scrollToCentre(); }, [c, first, listing]);
  // The pane takes its height from the window, so centre again when that changes
  const paneH = useRef(0);
  useEffect(() => {
    const el = codeRef.current;
    if (!el) return;
    const RO = el.ownerDocument.defaultView.ResizeObserver;
    const ro = new RO(() => { if (el.clientHeight !== paneH.current) { paneH.current = el.clientHeight; scrollToCentre(); } });
    ro.observe(el);
    return () => ro.disconnect();
  }, [listing.length > 0]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Once the listing first shows, widen this window if a row's bytes
  // (opcode) column is cut off: the columns are sized to the workbook's
  // longest label and operand, and the browser zoom or font can make them
  // wider than the window opened. Only grows, and only the once, so a
  // window the user makes narrower afterwards stays that way.
  const fitted = useRef(false);
  useEffect(() => {
    const el = codeRef.current, row = el?.firstElementChild, last = row?.lastElementChild;
    if (fitted.current || !last) return;
    fitted.current = true;
    const win = el.ownerDocument.defaultView;
    if (win === window) return;   // in the main page: nothing to resize
    const pane = el.getBoundingClientRect();
    // the bytes cell's right edge (with no horizontal scroll), the row's
    // right padding, the pane's scrollbar, and the margins outside the pane
    const need = last.getBoundingClientRect().right + el.scrollLeft + 24
               + (el.offsetWidth - el.clientWidth) + (win.innerWidth - pane.right);
    const frame = Math.max(0, win.outerWidth - win.innerWidth);
    const room = (win.screen?.availWidth ?? need) - frame - Math.max(0, win.screenX - (win.screen?.availLeft ?? 0));
    const grow = Math.min(need, room) - win.innerWidth;
    if (grow > 0) try { win.resizeBy(Math.ceil(grow), 0); } catch { /* the browser may refuse */ }
  }, [listing.length > 0]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Label search: every label containing the text is highlighted as you
  // type; GO / Enter goes to the exact label (else the first match), and
  // ◀ ▶ (or Enter / Shift+Enter again) step through the matches by address
  const q = jump.trim().toLowerCase();
  // Operand symbols of each row, and where each code label is defined
  const rowSyms = useMemo(() => listing.map(r => opSymbols(r.ops)), [listing]);
  const labelAt = useMemo(() => {
    const m = new Map();
    for (const r of listing) if (r.label && !m.has(r.label)) m.set(r.label, r.a);
    return m;
  }, [listing]);
  // Rows whose label, or a symbol in whose operands, contains the text
  const matchesFor = useCallback(t => t ? listing.filter((r, k) =>
      (r.label && r.label.toLowerCase().includes(t)) || rowSyms[k].some(x => x.s.toLowerCase().includes(t))).map(r => r.a) : [],
    [listing, rowSyms]);
  const matches = useMemo(() => matchesFor(q), [matchesFor, q]);
  const matchSet = useMemo(() => new Set(matches), [matches]);
  const [hit, setHit] = useState(-1);   // index in matches of the one shown
  const onMatch = hit >= 0 && matches[hit] === center;
  const goMatch = i => {
    const k = ((i % matches.length) + matches.length) % matches.length;
    setHit(k);
    setCenter(matches[k]);
  };
  const doJump = (dir = 0) => {
    if (!q) { setCenter(null); return; }
    if (matches.length) {
      if (onMatch && dir) return goMatch(hit + dir);
      const exact = listing.findIndex(r => r.label.toLowerCase() === q);
      const i = exact >= 0 ? matches.indexOf(listing[exact].a) : -1;
      return goMatch(i >= 0 ? i : dir < 0 ? matches.length - 1 : 0);
    }
    const a = parseInt(q, 16);
    if (!isNaN(a)) setCenter(a);
  };
  // ◀ ▶ are grayed out until the search has something to step through
  const stepBtn = matches.length ? btn(false) : {...btn(false), cursor:'not-allowed', opacity:0.4};
  // Clicking a label in an operand goes to where it is defined, with the
  // search set to it so ◀ ▶ step through the places that use it
  const goLabel = name => {
    const a = labelAt.get(name);
    if (a == null) return;
    setJump(name);
    setHit(matchesFor(name.toLowerCase()).indexOf(a));
    setCenter(a);
  };

  return (
    <div style={{...panel,display: hidden ? 'none' : 'flex',flexDirection:'column',minWidth:0,flex:'1 1 auto',minHeight:0}}>
      <div style={{...title,display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
        <span>{name}</span>
        <span style={{color:C.textBright,letterSpacing:'0.05em'}}>PC {hx(pc, cpu === 'dme' ? 4 : 3)}</span>
        {routine && <span style={{color:C.amber,textTransform:'none',letterSpacing:0}}>in {routine}</span>}
        {rom && <RomName path={rom} cpu={cpu} bridge={url} style={{color:C.textDim,textTransform:'none',letterSpacing:0}} />}
        {edited > 0 && (
          <span style={{display:'inline-flex',gap:'4px',alignItems:'center',textTransform:'none',letterSpacing:0}}>
            <span style={{color:MODIFIED,cursor:'pointer',textDecoration:'underline dotted'}} onClick={() => setShowEdits(true)}
                  title="Bytes changed from the image as it was loaded (the code column's ✎ rows). The edits are live and stay through RESTART until another image is loaded.\nClick for the list of edits, to copy">
              ✎ {edited} byte{edited > 1 ? 's' : ''} edited</span>
            {showEdits && <EditsList bridge={url} cpu={cpu} name={rom?.split(/[\\/]/).pop()} onClose={() => setShowEdits(false)} />}
            <button style={btn(false, C.amber)} disabled={!canEdit} onClick={() => revertRom(cpu)}
                    title={canEdit ? 'Put back the image as it was loaded' : 'Pause the simulation to revert'}>REVERT ALL</button>
          </span>
        )}
        <span style={{marginLeft:'auto',display:'inline-flex',gap:'4px',textTransform:'none',letterSpacing:0}}>
          <input value={jump} onChange={e => { setJump(e.target.value); setHit(-1); }}
                 onKeyDown={e => e.key === 'Enter' && doJump(onMatch ? (e.shiftKey ? -1 : 1) : 0)}
                 placeholder="label or hex" style={{...inp,width:'110px'}}
                 title="Type part of a label to highlight every row that defines or uses one that matches (labels and operands). Enter goes to the next match, Shift+Enter the previous one; or type a hex address" />
          <button style={btn(false)} onClick={() => doJump()}>GO</button>
          <button style={stepBtn} disabled={!matches.length} onClick={() => doJump(-1)}
                  title={matches.length ? 'Previous match (Shift+Enter)' : 'Type a label to search first'}>◀</button>
          <button style={stepBtn} disabled={!matches.length} onClick={() => doJump(1)}
                  title={matches.length ? 'Next match (Enter)' : 'Type a label to search first'}>▶</button>
          {q && (matches.length
            ? <span style={{color:C.amber,alignSelf:'center',minWidth:'6ch'}}>{onMatch ? `${hit + 1}/${matches.length}` : `${matches.length} match${matches.length > 1 ? 'es' : ''}`}</span>
            : isNaN(parseInt(q, 16)) && <span style={{color:C.red,alignSelf:'center'}}>no match</span>)}
          {center != null && <button style={btn(false)} onClick={() => { setCenter(null); setJump(''); }}>PC</button>}
          <HexDec />
          <button style={btn(false)} onClick={onClose}
                  title={`Close this window (reopen it with ${cpu.toUpperCase()} CODE on the main page)`}>✕</button>
        </span>
      </div>
      {(
        <div style={{display:'flex',gap:'4px',flexWrap:'wrap',alignItems:'center',fontSize:'10px',marginBottom:'4px'}}>
          <span style={{color:C.textDim}}>BREAKPOINTS</span>
          {allBps.length === 0 && <span style={{color:'#779977'}}>none · click an address in the listing to add one</span>}
          {allBps.map(a => {
            const lbl = listing.length ? listing[rowFor(listing, a)] : null;
            const on = bpSet.has(a), k = condOf(a);
            const now = k && !running ? condNow(k, ram) : null;
            const hit = !running ? bpHitOf(reason) : null;
            const hitHere = hit && hit.cpu === cpu && hit.a === a;
            return (
              <span key={a} style={{display:'inline-flex',alignItems:'center',border:`1px solid ${C.border}`,background:C.panelBg2}}>
                <input type="checkbox" checked={on} title={on ? 'Disable breakpoint' : 'Enable breakpoint'}
                       onChange={e => setEnabled(a, e.target.checked)}
                       style={{margin:'0 2px 0 4px',accentColor:C.red,cursor:'pointer'}} />
                <span style={{color: on ? C.red : C.textDim,padding:'1px 5px 1px 2px',cursor:'pointer'}} title="Show in listing"
                      onClick={() => { setCenter(a); setJump(hx(a, 4)); }}>
                  {on ? '●' : '○'} {hx(a, cpu === 'dme' ? 4 : 3)}{lbl?.a === a && lbl.label ? ` ${lbl.label}` : ''}
                </span>
                <span style={{color: k ? (on ? C.amber : C.textDim) : '#557755',padding:'1px 5px',cursor:'pointer',borderLeft:`1px solid ${C.border}`,
                              textTransform:'none'}}
                      title={k ? `Stops only when ${condText(cpu, k)}${now ? ` (now ${k.bit != null ? now.x : `${hx(now.x)}h`}: ${now.ok ? 'true' : 'false'})` : ''}. Click to edit`
                               : 'Add a memory condition: stop here only when a RAM byte or bit compares true'}
                      onClick={() => setEditing(editing === a ? null : a)}>
                  {k ? `if ${condText(cpu, k)}` : '+if'}
                </span>
                {hitHere && (
                  <span style={{color:C.blue,padding:'1px 5px',borderLeft:`1px solid ${C.border}`,textTransform:'none'}}
                        title="The value the condition compared when this breakpoint stopped">
                    hit: {hit.bit != null ? hit.now : `${hx(hit.now)}h (${hit.now})`}
                  </span>
                )}
                <span style={{color:C.textDim,padding:'1px 5px',cursor:'pointer',borderLeft:`1px solid ${C.border}`}}
                      title="Remove breakpoint" onClick={() => removeBp(a)}>✕</span>
              </span>
            );
          })}
          {allBps.length > 1 && (
            <button style={btn(false, C.red)} onClick={() => { send(bps.map(a => bpCmd('del', a)).join('\n')); setDisabled([]); setOffConds({}); setEditing(null); }}>
              CLEAR ALL
            </button>
          )}
        </div>
      )}
      {editing != null && allBps.includes(editing) && (
        <CondEditor key={editing} cpu={cpu} addr={editing} cond={condOf(editing)} ram={running ? null : ram}
                    onSet={k => setCond(editing, k)} onClear={() => setCond(editing, null)} onCancel={() => setEditing(null)} />
      )}
      <WatchPanel cpu={cpu} watches={watches} watchOk={watchOk} writes={writes} writers={writers} send={send} listing={listing}
                  ram={ram} running={running} connected={connected}
                  onJump={a => { setCenter(a); setJump(hx(a, cpu === 'dme' ? 4 : 3)); }} />
      <CameFrom cpu={cpu} trace={running ? [] : trace} listing={listing}
                onJump={a => { setCenter(a); setJump(hx(a, 4)); }} />
      <StackView cpu={cpu} ram={ram} regs={regs} listing={listing} running={running}
                 onJump={a => { setCenter(a); setJump(hx(a, 4)); }} />
      {!listing.length ? (
        <div style={{color:C.textDim,fontSize:'10px',padding:'20px',height:`${CODE_ROWS * ROW_H}px`,boxSizing:'border-box'}}>No disassembly from the bridge.</div>
      ) : (
        <div ref={codeRef} style={{fontSize:'10.5px',lineHeight:`${ROW_H}px`,flex:'3 1 0',minHeight:`${8 * ROW_H}px`,position:'relative',
                                   overflow:'auto',whiteSpace:'nowrap',border:`1px solid ${C.border}`}}>
          {rows.map(r => {
            const isPc = r.a === pc && !running, hasBp = bpSet.has(r.a), wasRecent = recent.has(r.a);
            const isOff = offSet.has(r.a);
            const isMatch = matchSet.has(r.a), isHit = isMatch && onMatch && r.a === center;
            // Values as this instruction saw them (blank if it isn't in the trace)
            const st = running ? null : traceState(cpu, lastCtx.get(r.a), r);
            const val = st ? (cpu === 'dme' ? dmeOperandValues : klrOperandValues)(r, st.ram, st.regs) : '';
            return (
              <div key={r.a} title={`${r.desc ? `${r.desc}\n\n` : ''}${condOf(r.a) ? `Breakpoint if ${condText(cpu, condOf(r.a))}\n\n` : ''}Click to toggle a breakpoint`}
                   onClick={() => hasBp ? removeBp(r.a) : isOff ? setEnabled(r.a, true) : send(bpCmd('add', r.a))}
                   style={{display:'flex',gap:'8px',cursor:'pointer',padding:'0 4px',textAlign:'left',height:`${ROW_H}px`,
                           width:'max-content',minWidth:'100%',boxSizing:'border-box',
                           background: isPc ? '#1a4a1a' : r.a === writer ? '#3a2a00' : isHit ? '#4a3a00' : isMatch ? '#241c00' : wasRecent ? '#0c1d0c' : 'transparent',
                           outline: isHit ? '1px solid #ffcc00' : 'none', outlineOffset:'-1px',
                           borderLeft: `2px solid ${isPc ? C.textBright : isHit ? '#ffcc00' : 'transparent'}`}}>
                <span style={{width:'10px',color: hasBp ? (conds[r.a] ? C.amber : C.red) : r.a === writer ? C.amber : C.textDim}}
                      title={r.a === writer ? `This instruction changed ${watchText(wHit)} (the watch stop)` : undefined}>
                  {hasBp ? '●' : isOff ? '○' : r.a === writer ? '✎' : ''}</span>
                <span style={{color: isPc ? C.textBright : '#77aa77',width:'34px'}}>{hx(r.a, cpu === 'dme' ? 4 : 3)}</span>
                <span style={{color:C.amber,width:`${colW.label}ch`,flex:'none',overflow:'hidden',textOverflow:'ellipsis'}} title={r.label}>{isMatch ? marked(r.label, q) : r.label}</span>
                <span style={{color:C.textBright,width:'5ch',flex:'none'}}>{r.instr}</span>
                <span style={{color:C.textDim,width:`${colW.ops}ch`,flex:'none'}}>
                  <OpsText ops={r.ops} q={isMatch ? q : ''} labelAt={labelAt} onLabel={goLabel} /></span>
                <span style={{color: running ? '#557799' : C.blue,width:'22ch',flex:'none',overflow:'hidden',textOverflow:'ellipsis'}}
                      title={val && `${val}  (as this instruction last ran, before it executed)`}>{val}</span>
                <BytesCell cpu={cpu} r={r} editing={editAt === r.a} canEdit={canEdit}
                           onEdit={on => setEditAt(on ? r.a : null)}
                           onWrite={bytes => { setEditAt(null); patchRom(cpu, r.a, bytes); }} />
              </div>
            );
          })}
        </div>
      )}
      <TraceList cpu={cpu} trace={running ? [] : trace} traceCtx={traceCtx} listing={listing} colW={colW} running={running}
                 labelAt={labelAt} onLabel={goLabel}
                 onJump={a => { setCenter(a); setJump(hx(a, cpu === 'dme' ? 4 : 3)); }} />
    </div>
  );
}

// The last instructions executed, oldest first, disassembled. Values are the
// operands as that particular execution saw them. A rule marks where control
// arrived by a jump, call, return or interrupt rather than falling through.
// Back-to-back repeats of one instruction or a short loop (a busy-wait such
// as `jnb IE1, $`) show once with a ×N count and the latest repetition's values.
const TRACE_SHOWN = 128;    // rows kept (the pane scrolls), after repeats are collapsed
const TRACE_LOOP_MAX = 8;   // longest loop body that is collapsed
function compactTrace(steps) {
  const out = [];
  const same = (k, m, len) => { for (let j = 0; j < len; j++) if (steps[k + j].a !== steps[m + j].a) return false; return true; };
  for (let k = 0; k < steps.length;) {
    let best = { len: 1, reps: 1 };
    for (let len = 1; len <= TRACE_LOOP_MAX && k + 2 * len <= steps.length; len++) {
      let reps = 1;
      while (k + (reps + 1) * len <= steps.length && same(k, k + reps * len, len)) reps++;
      // Most instructions covered wins; on a tie the shorter loop
      if (reps > 1 && len * reps > best.len * best.reps) best = { len, reps };
    }
    const lastRep = k + (best.reps - 1) * best.len;
    for (let j = 0; j < best.len; j++)
      out.push({ ...steps[lastRep + j], jumped: steps[k + j].jumped, reps: best.reps, loopLen: best.len, loopPos: j, start: k });
    k += best.len * best.reps;
  }
  return out;
}
function TraceList({ cpu, trace, traceCtx, listing, colW, running, onJump, labelAt, onLabel }) {
  const [open, setOpen] = useState(true);
  const steps = useMemo(() => trace.map((a, i) => {
    const row = listing.length ? listing[rowFor(listing, a)] : null;
    const r = row?.a === a ? row : null;
    const st = r ? traceState(cpu, traceCtx?.[i], r) : null;
    const val = st ? (cpu === 'dme' ? dmeOperandValues : klrOperandValues)(r, st.ram, st.regs) : '';
    // Where the previous instruction would have fallen through to: the next listing row
    const next = i > 0 && listing.length ? listing[rowFor(listing, trace[i - 1]) + 1]?.a : null;
    return { i, a, r, val, jumped: i > 0 && next !== a };
  }), [cpu, trace, traceCtx, listing]);
  // Collapse over the whole trace, then keep the newest rows
  const shown = useMemo(() => compactTrace(steps).slice(-TRACE_SHOWN), [steps]);
  const covered = shown.length ? steps.length - shown[0].start : 0;   // instructions those rows stand for
  const w = cpu === 'dme' ? 4 : 3;
  // Newest at the bottom: open scrolled to the end each time the trace refreshes
  const listRef = useRef(null);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown, open]);
  return (
    <div style={{marginTop:'6px',borderTop:`1px solid ${C.border}`,paddingTop:'4px',display:'flex',flexDirection:'column',
                 flex: open ? '2 1 0' : 'none',minHeight: open ? `${6 * ROW_H}px` : 0}}>
      <div style={{...title,display:'flex',gap:'8px',alignItems:'center',marginBottom:'2px',cursor:'pointer',flex:'none'}}
           onClick={() => setOpen(o => !o)} title={open ? 'Hide' : 'Show'}>
        <span>{open ? '▾' : '▸'} {covered ? `last ${covered} executed` : 'recent instructions'}</span>
        <span style={{textTransform:'none',letterSpacing:0,color:'#557755'}}>
          oldest first · newest at the bottom{shown.length < covered ? ` · repeats collapsed (×N) into ${shown.length} rows` : ''}
        </span>
      </div>
      {open && (
        <div ref={listRef} style={{fontSize:'10.5px',lineHeight:`${ROW_H}px`,flex:'1 1 0',minHeight:`${4 * ROW_H}px`,
                                   overflow:'auto',whiteSpace:'nowrap',border:`1px solid ${C.border}`}}>
          {!shown.length && (
            <div style={{color:'#557755',padding:'4px'}}>{running ? 'shown when the sim stops' : 'no trace yet'}</div>
          )}
          {shown.map(({ i, a, r, val, jumped, reps, loopLen, loopPos }, k) => {
            const last = k === shown.length - 1;
            const inLoop = reps > 1 && loopLen > 1;
            const repTitle = reps > 1 ? (loopLen > 1
              ? `This ${loopLen}-instruction loop ran ${reps} times in a row; values are from the last pass`
              : `Ran ${reps} times in a row; values are from the last time`) : '';
            return (
              <div key={i} onClick={() => onJump(a)} title={`${r?.desc ? `${r.desc}\n\n` : ''}${repTitle ? `${repTitle}\n\n` : ''}Show in listing`}
                   style={{display:'flex',gap:'8px',cursor:'pointer',padding:'0 4px',textAlign:'left',
                           width:'max-content',minWidth:'100%',boxSizing:'border-box',
                           borderTop: jumped ? `1px dashed ${C.border}` : '1px solid transparent',
                           borderLeft: `2px solid ${inLoop ? C.amber : 'transparent'}`,
                           background: last ? '#0c1d0c' : 'transparent'}}>
                <span style={{width:'10px',color:C.textDim}} title={jumped ? 'arrived by a jump, call, return or interrupt' : ''}>{jumped ? '↳' : ''}</span>
                <span style={{width:'4ch',flex:'none',color:C.amber}} title={repTitle}>{reps > 1 && loopPos === 0 ? `×${reps}` : ''}</span>
                <span style={{color: last ? C.textBright : '#77aa77',width:'34px'}}>{hx(a, w)}</span>
                {r ? (<>
                  <span style={{color:C.amber,width:`${colW.label}ch`,flex:'none',overflow:'hidden',textOverflow:'ellipsis'}} title={r.label}>{r.label}</span>
                  <span style={{color:C.textBright,width:'5ch',flex:'none'}}>{r.instr}</span>
                  <span style={{color:C.textDim,width:`${colW.ops}ch`,flex:'none'}}>
                    <OpsText ops={r.ops} labelAt={labelAt} onLabel={onLabel} /></span>
                  <span style={{color:C.blue,width:'22ch',flex:'none',overflow:'hidden',textOverflow:'ellipsis'}}
                        title={val && `${val}  (as this execution saw them, before it ran)`}>{val}</span>
                  <span style={{color:'#557755',width:'9ch',flex:'none',overflow:'hidden'}}>{r.bytes}</span>
                </>) : (
                  <span style={{color:C.textDim}}>not an instruction start in the listing</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Snapshots: the whole model, saved on each warning (or SAVE NOW) ──
// The sim saves every variable of the model plus inputs, breakpoints,
// trace and both EPROM images; LOAD restarts it from that moment (the
// charts get the run up to it), so debugging carries on from there.
const fmtMs = ns => ns == null ? '--' : (ns / 1e6).toFixed(3);
const short = h => h ? h.slice(0, 12) : '--';

function SnapshotPanel({ live, running, url }) {
  const { connected, snapshots = [], snapCfg, loadedSnap, snapBusy, send, loadSnapshot, addTestSnapshot, deleteSnapshot, deleteSnapshots, downloadSnapshot, uploadSnapshot, snapshotDetail } = live;
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [testName, setTestName] = useState('');
  const [testMs, setTestMs] = useState('');
  const addTest = async () => {
    if (testName.trim() && testMs.trim() && await addTestSnapshot(testName.trim(), +testMs, label)) {
      setTestMs(''); setLabel(''); setOpen(true);
    }
  };
  const [detail, setDetail] = useState(null);   // {id, data}
  const pick = useRef(null);
  // A new snapshot opens the list so it's noticed
  const newest = snapshots[0]?.id;
  const [seen, setSeen] = useState(newest);
  if (newest !== seen) {
    setSeen(newest);
    if (newest) setOpen(true);
  }
  const showDetail = async id => {
    if (detail?.id === id) { setDetail(null); return; }
    const data = await snapshotDetail(id);
    if (data) setDetail({ id, data });
  };
  const badge = r => ({ warn: C.red, fail: C.red, manual: C.blue, upload: C.amber, test: '#cc88ff' }[r] ?? C.textDim);
  const loadedTest = snapshots.find(s => s.id === loadedSnap && s.kind === 'test');
  // CLEAR TESTS: every regression-test (TEST) row, after an "are you sure"
  const tests = snapshots.filter(s => s.kind === 'test');
  const clearTests = async () => {
    const n = tests.length;
    if (!n || !confirm(`Are you sure? This deletes all ${n} regression test snapshot${n === 1 ? '' : 's'} (TEST rows) and can't be undone.\n\n`
                       + 'Your other snapshots (warnings, SAVE NOW, uploads) stay.')) return;
    if (detail && tests.some(t => t.id === detail.id)) setDetail(null);
    await deleteSnapshots(tests.map(t => t.id));
  };
  return (
    <div style={{...panel,fontSize:'10px',padding:'5px 10px'}}>
      <div style={{display:'flex',gap:'10px',alignItems:'center',flexWrap:'wrap'}}>
        <span style={{...title,marginBottom:0,cursor:'pointer'}} onClick={() => setOpen(o => !o)}>
          {open ? '▾' : '▸'} SNAPSHOTS ({snapshots.length})
        </span>
        <input value={label} onChange={e => setLabel(e.target.value)} placeholder="label" style={{...inp,width:'110px'}}
               onKeyDown={e => { if (e.key === 'Enter') { send(`save ${label}`); setLabel(''); } }} />
        <button style={btn(false)} disabled={!connected} onClick={() => { send(`save ${label}`); setLabel(''); }}
                title="Save the whole simulator state now (taken at the next quiescent moment, within a few ns)">📷 SAVE NOW</button>
        <label style={{color:C.textDim,cursor:'pointer'}} title="Save a snapshot when the sim prints a warning or error ([WARN], WARNING, ERROR): at most once a sim second per kind of warning">
          <input type="checkbox" checked={!!snapCfg?.auto} disabled={!connected}
                 onChange={e => send(`autosnap ${e.target.checked ? 'on' : 'off'}`)} /> AUTO ON WARNING
          {snapCfg?.auto && <span style={{color:'#779977'}}> ({snapCfg.taken}/{snapCfg.max} this run)</span>}
        </label>
        <label style={{color:C.textDim,cursor:'pointer'}} title="Also pause the simulation after a warning's snapshot">
          <input type="checkbox" checked={!!snapCfg?.brk} disabled={!connected}
                 onChange={e => send(`breakonwarn ${e.target.checked ? 'on' : 'off'}`)} /> PAUSE ON WARNING
        </label>
        <input ref={pick} type="file" accept=".dmesnap" style={{display:'none'}}
               onChange={e => { const f = e.target.files[0]; e.target.value = ''; uploadSnapshot(f); setOpen(true); }} />
        <button style={btn(false)} disabled={!connected} onClick={() => pick.current.click()}
                title="Add a snapshot saved earlier with ⬇ (.dmesnap)">UPLOAD .dmesnap</button>
        <button style={btn(false, C.red)} disabled={!connected || !tests.length} onClick={clearTests}
                title="Delete every regression test snapshot (the TEST rows); asks first. The other snapshots stay">
          ✕ CLEAR TESTS ({tests.length})</button>
        {loadedSnap && !loadedTest && <span style={{color:C.amber}} title={loadedSnap}>running from snapshot {loadedSnap}</span>}
        {loadedTest && <span style={{color:'#cc88ff'}} title={loadedSnap}>
          regression test {loadedTest.test}: inputs follow its script (the controls do nothing) · RESTART returns to the live sim</span>}
      </div>
      {open && (
        <div style={{display:'flex',gap:'8px',alignItems:'center',marginTop:'6px',flexWrap:'wrap'}}
             title="A regression test (a name from run_dashboard_tests.sh) at a time you pick: it appears as a TEST row, and LOAD builds the test and runs it there">
          <span style={{color:'#cc88ff'}}>TEST</span>
          <input value={testName} onChange={e => setTestName(e.target.value)} placeholder="test, e.g. cl_ramp_to_3000" style={{...inp,width:'220px'}} />
          <span style={{color:C.textDim}}>at</span>
          <input value={testMs} onChange={e => setTestMs(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="ms" style={{...inp,width:'70px'}}
                 onKeyDown={e => { if (e.key === 'Enter') addTest(); }} />
          <span style={{color:C.textDim}}>ms</span>
          <button style={btn(false, '#cc88ff')} disabled={!connected || !testName.trim() || !testMs.trim()} onClick={addTest}>+ ADD</button>
        </div>
      )}
      {snapBusy && <div style={{color:'#cc88ff',marginTop:'4px'}}>⏳ {snapBusy}</div>}
      {open && (
        <div style={{marginTop:'6px',maxHeight:'260px',overflowY:'auto'}}>
          {snapshots.length === 0 && <div style={{color:'#557755'}}>No snapshots yet. One is saved whenever the sim prints a warning, or press SAVE NOW.</div>}
          {snapshots.map(s => (
            <div key={s.id} style={{borderTop:`1px solid ${C.border}`,padding:'3px 0'}}>
              <div style={{display:'flex',gap:'8px',alignItems:'center',minWidth:0}}>
                <span style={{color:badge(s.reason),minWidth:'48px'}}>{(s.reason ?? '').toUpperCase()}</span>
                <span style={{color:C.textBright,minWidth:'92px'}}>t={fmtMs(s.t_ns)} ms</span>
                <span style={{color:C.textDim,flex:1,minWidth:0,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}
                      title={s.trigger || s.label || s.id}>{s.trigger || s.label || s.id}</span>
                <span style={{color:'#779977',whiteSpace:'nowrap'}} title={`DME ${s.roms?.dme?.name} sha256 ${s.roms?.dme?.sha256 ?? '?'}\nKLR ${s.roms?.klr?.name} sha256 ${s.roms?.klr?.sha256 ?? '?'}`}>
                  <RomName path={s.roms?.dme?.name} cpu="dme" bridge={url} /> · <RomName path={s.roms?.klr?.name} cpu="klr" bridge={url} />
                </span>
                <button style={btn(false, C.amber)} disabled={!connected || !!snapBusy}
                        onClick={() => (!running || confirm('The simulation is running. Restart it from this snapshot?')) && loadSnapshot(s.id)}
                        title={s.kind === 'test'
                          ? `Run regression test ${s.test} to this moment and pause there. The first time, it's built with the debugger first (a few minutes); running there takes as long as the sim needs to reach ${fmtMs(s.t_ns)} ms`
                          : 'Restart the simulator from this snapshot: same model state, inputs, breakpoints and EPROM images'}>LOAD</button>
                <button style={btn(detail?.id === s.id)} onClick={() => showDetail(s.id)} title="Inputs, ROM identity, registers">INFO</button>
                <button style={btn(false)} onClick={() => downloadSnapshot(s.id)} title="Download as one .dmesnap file to keep or share">⬇</button>
                <button style={btn(false, C.red)} onClick={() => confirm(`Delete snapshot ${s.id}?`) && deleteSnapshot(s.id)} title="Delete">✕</button>
              </div>
              {detail?.id === s.id && (detail.data.kind === 'test' ? <TestSnapshotDetail d={detail.data} url={url} /> : <SnapshotDetail d={detail.data} url={url} />)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// A regression test's warning (test_snap.py): what LOAD will build and run
function TestSnapshotDetail({ d, url }) {
  const row = (k, v) => (
    <div style={{display:'flex',gap:'8px',lineHeight:1.4}}>
      <span style={{color:C.textDim,minWidth:'90px'}}>{k}</span>
      <span style={{color:C.textBright,wordBreak:'break-all'}}>{v}</span>
    </div>
  );
  return (
    <div style={{padding:'4px 0 4px 56px',display:'flex',flexDirection:'column',gap:'2px'}}>
      {row('test', `${d.test}  (${d.script ?? 'run_dashboard_tests.sh'})`)}
      {row('recorded', `${d.created ?? '--'}  (${d.id})`)}
      {row('trigger', d.trigger)}
      {row('runs to', `${fmtMs(d.t_ns)} ms`)}
      {row('defines', (d.defines ?? []).join(' '))}
      {row('DME ROM', d.roms?.dme ? <RomName path={d.roms.dme} cpu="dme" bridge={url} title={d.roms.dme} /> : '--')}
      {row('KLR ROM', d.roms?.klr ? <RomName path={d.roms.klr} cpu="klr" bridge={url} title={d.roms.klr} /> : '--')}
      {row('log', d.log ?? '--')}
      {row('build', d.built ? 'ready (obj/tests/' + d.test + ')' : 'not built yet: LOAD builds it first')}
    </div>
  );
}

function SnapshotDetail({ d, url }) {
  const kv = obj => Object.entries(obj ?? {}).map(([k, v]) => `${k}=${v}`).join('  ');
  // The debugger's own register lines, as the testbench printed them at that moment
  const regsLine = cpu => {
    const l = d.lines?.find(x => x.startsWith(`SIM: [REGS] ${cpu} `));
    return l ? l.slice(`SIM: [REGS] ${cpu} `.length).replace(/t_ms=\S+\s*/, '').trim().split(/\s+/).join('  ') : '--';
  };
  const row = (k, v) => (
    <div style={{display:'flex',gap:'8px',lineHeight:1.4}}>
      <span style={{color:C.textDim,minWidth:'90px'}}>{k}</span>
      <span style={{color:C.textBright,wordBreak:'break-all'}}>{v}</span>
    </div>
  );
  const rom = cpu => {
    const m = d.manifest?.roms?.[cpu], r = d.roms?.[cpu];
    return <><RomName path={m?.name ?? r?.path} cpu={cpu} bridge={url} />{`  sha256 ${short(m?.sha256)}…  crc32 ${r?.crc32 ?? '--'}  ${m?.workbook ? `listing ${m.workbook}` : 'no workbook'}`}</>;
  };
  return (
    <div style={{padding:'4px 0 4px 56px',display:'flex',flexDirection:'column',gap:'2px'}}>
      {row('saved', `${d.created ?? '--'}  (${d.id})`)}
      {d.trigger && row('trigger', d.trigger)}
      {row('PC', `DME ${d.pc?.dme ?? '--'}  KLR ${d.pc?.klr ?? '--'}`)}
      {row('inputs', kv(d.inputs))}
      {row('DME ROM', rom('dme'))}
      {row('KLR ROM', rom('klr'))}
      {row('DME regs', regsLine('dme'))}
      {row('KLR regs', regsLine('klr'))}
      {row('breakpoints', `DME ${d.breakpoints?.dme?.join(',') || '-'}  KLR ${d.breakpoints?.klr?.join(',') || '-'}`)}
      {d.afm_pending?.length > 0 && row('AFM pending', d.afm_pending.map(a => `${a.value} at ${fmtMs(a.t_ns)} ms`).join(', '))}
      {row('model', `${d.model?.fields ?? '?'} variables, ${d.model?.bytes ?? '?'} bytes, ${d.manifest?.history_lines ?? 0} lines of run history`)}
    </div>
  );
}
