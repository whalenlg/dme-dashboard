import { useState, useMemo, useEffect, useLayoutEffect, useRef, memo } from "react";
import { fmtBoost, boostParts } from "./boost.js";
import { thin, syncNearest, inRange } from "./thin.js";
import { useZoom, zoomHandlers, ZoomBox, DragArea, ZoomBar } from "./zoom.jsx";
import { dmeOperandValues, klrOperandValues, decodeStack, cameFrom, traceState, STACK } from "./asmValues.js";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { memName } from "./memDefs.js";
import { MemSearch } from "./memSearch.jsx";
import { Popout } from "./popout.jsx";
import RomCompare from "./RomCompare.jsx";

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
  { k:'altitude',  label:'ALTITUDE (ch4)', positions:[0xF8,0x00], names:['under 1000 m','over 1000 m'],
    hint:'ch4 raw F8 / 00, as TEST_IDLE_HIGH_ALT' },
  { k:'ac',        label:'AC (T1)',      positions:[0,1], names:['off','on'],
    hint:'DME T1 (P3.5): AC compressor; the closed-loop model adds its load and the ISV should catch it' },
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
  const [comparing, setComparing] = useState(false);
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
        <button style={btn(false)} onClick={onClose}>✕ DISCONNECT</button>
      </div>
      <RomRow roms={roms} asmSrc={asmSrc} paused={connected && sim.state === 'paused'} loadRom={loadRom}
              comparing={comparing} toggleCompare={() => setComparing(c => !c)} />
      {comparing && <RomCompare url={url} roms={roms} onClose={() => setComparing(false)} />}
      <SnapshotPanel live={live} running={running} />
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

      {/* The code debuggers, each in its own window */}
      {['dme', 'klr'].map(cpu => (
        <Popout key={cpu} entry={codeWin[cpu]} title={`${cpu.toUpperCase()} CODE`}
                sub={`live simulation · ${!connected ? 'OFFLINE' : sim.state} · t=${tMs} ms`}>
          {/* Fills the window: the listing and the trace share its height */}
          <div style={{textAlign:'left',display:'flex',flexDirection:'column',gap:'8px',height:'100%',minHeight:'520px'}}>
            <RunBar cpu={cpu} sim={sim} connected={connected} running={running} send={send} />
            <AsmPanel cpu={cpu} name={cpu === 'dme' ? 'DME 8051' : 'KLR 8048'} listing={asm[cpu]} pc={cpu === 'dme' ? sim.dmePc : sim.klrPc}
                      bps={bps[cpu]} conds={bpConds?.[cpu]} reason={sim.reason} trace={trace[cpu]} traceCtx={traceCtx?.[cpu]}
                      ram={mem?.[cpu]} regs={regs?.[cpu]} running={running} stopKey={stopKey} send={send}
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
  const h = bpHitOf(reason);
  if (!h) return <span style={{color:C.amber,fontSize:'10px'}}>stopped: {reason}</span>;
  return (
    <span style={{color:C.amber,fontSize:'10px'}}>
      stopped: bp {h.cpu} {h.pc} · <span style={{color:C.blue}}>{hitText(h)}</span>
      <span style={{color:C.textDim}}> (condition {h.op} {h.bit != null ? h.val : `${hx(h.val)}h`})</span>
    </span>
  );
}

// ── Run / pause / step / run-to, at the top of each code window ──
function RunBar({ cpu, sim, connected, running, send }) {
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
      <input value={untilMs} onChange={e => setUntil(e.target.value)} placeholder="ms" style={{...inp,width:'56px'}}
             onKeyDown={e => e.key === 'Enter' && untilMs && send(`until ${untilMs}`)} />
      <button style={btn(false)} disabled={running || !untilMs} onClick={() => send(`until ${untilMs}`)}
              title="Run until this sim time (ms), then pause">RUN TO</button>
    </div>
  );
}

// ── ROM images: what each EPROM holds, and loading another .mem ──
function RomRow({ roms, asmSrc, paused, loadRom, comparing, toggleCompare }) {
  const [reset, setReset] = useState(true);
  const pick = { dme: useRef(null), klr: useRef(null) };
  const name = p => p ? p.split(/[\\/]/).pop() : '--';
  return (
    <div style={{...panel,display:'flex',gap:'14px',alignItems:'center',flexWrap:'wrap',fontSize:'10px',padding:'5px 10px'}}>
      <span style={{...title,marginBottom:0}}>ROM IMAGES</span>
      {['dme', 'klr'].map(cpu => (
        <span key={cpu} style={{display:'inline-flex',gap:'6px',alignItems:'center'}}>
          <span style={{color:C.textDim}}>{cpu.toUpperCase()}</span>
          <span style={{color:C.textBright}} title={roms?.[cpu] ?? ''}>{name(roms?.[cpu])}</span>
          {asmSrc?.[cpu] && (asmSrc[cpu].match === 'none'
            ? <span style={{color:'#ccaa44'}} title="This image doesn't match any disassembly workbook, so the debugger listing is the default one and may not line up with the code">ASM: no workbook</span>
            : <span style={{color:C.textDim}} title={`Debugger listing from ${cpu}/disassemble/${asmSrc[cpu].workbook} (image matched by ${asmSrc[cpu].match})`}>ASM: {asmSrc[cpu].workbook}</span>)}
          <input ref={pick[cpu]} type="file" accept=".mem" style={{display:'none'}}
                 onChange={e => { const f = e.target.files[0]; e.target.value = ''; loadRom(cpu, f, reset); }} />
          <button style={{...btn(paused), cursor: paused ? 'pointer' : 'not-allowed'}} disabled={!paused} onClick={() => pick[cpu].current.click()}
                  title={paused ? `Load a .mem image into the ${cpu.toUpperCase()} EPROM` : 'Pause the simulation to load a ROM'}>
            LOAD .mem
          </button>
        </span>
      ))}
      <label style={{color:C.textDim,cursor:'pointer'}}
             title="On: restart the sim at t=0 on the new image (the other EPROM keeps its image). Off: swap the image in place; the CPU keeps its PC and RAM.">
        <input type="checkbox" checked={reset} onChange={e => setReset(e.target.checked)} /> RESTART AFTER LOAD
      </label>
      {!paused && <span style={{color:'#779977'}}>pause to load a ROM</span>}
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
                  <label key={i} title={`0x${hx(raw)}`}
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
          </div>
        );
      })}
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

function AsmPanel({ cpu, name, listing, pc, bps, conds = {}, reason, trace, traceCtx, ram, regs, running, stopKey, send, hidden, onClose }) {
  const [jump, setJump]   = useState('');
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

  // Label search: every label containing the text is highlighted as you
  // type; GO / Enter goes to the exact label (else the first match), and
  // ◀ ▶ (or Enter / Shift+Enter again) step through the matches by address
  const q = jump.trim().toLowerCase();
  const matches = useMemo(() => q ? listing.filter(r => r.label && r.label.toLowerCase().includes(q)).map(r => r.a) : [],
                          [listing, q]);
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
  // The matched part of a label, marked
  const markLabel = label => {
    const i = q && label ? label.toLowerCase().indexOf(q) : -1;
    if (i < 0) return label;
    return <>{label.slice(0, i)}<mark style={{background:'#ffcc00',color:'#000',padding:0}}>{label.slice(i, i + q.length)}</mark>{label.slice(i + q.length)}</>;
  };

  return (
    <div style={{...panel,display: hidden ? 'none' : 'flex',flexDirection:'column',minWidth:0,flex:'1 1 auto',minHeight:0}}>
      <div style={{...title,display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
        <span>{name}</span>
        <span style={{color:C.textBright,letterSpacing:'0.05em'}}>PC {hx(pc, cpu === 'dme' ? 4 : 3)}</span>
        {routine && <span style={{color:C.amber,textTransform:'none',letterSpacing:0}}>in {routine}</span>}
        <span style={{marginLeft:'auto',display:'inline-flex',gap:'4px',textTransform:'none',letterSpacing:0}}>
          <input value={jump} onChange={e => { setJump(e.target.value); setHit(-1); }}
                 onKeyDown={e => e.key === 'Enter' && doJump(onMatch ? (e.shiftKey ? -1 : 1) : 0)}
                 placeholder="label or hex" style={{...inp,width:'110px'}}
                 title="Type part of a label to highlight every match. Enter goes to the next match, Shift+Enter the previous one; or type a hex address" />
          <button style={btn(false)} onClick={() => doJump()}>GO</button>
          <button style={btn(false)} disabled={!matches.length} onClick={() => doJump(-1)} title="Previous match (Shift+Enter)">◀</button>
          <button style={btn(false)} disabled={!matches.length} onClick={() => doJump(1)} title="Next match (Enter)">▶</button>
          {q && (matches.length
            ? <span style={{color:C.amber,alignSelf:'center',minWidth:'6ch'}}>{onMatch ? `${hit + 1}/${matches.length}` : `${matches.length} match${matches.length > 1 ? 'es' : ''}`}</span>
            : isNaN(parseInt(q, 16)) && <span style={{color:C.red,alignSelf:'center'}}>no match</span>)}
          {center != null && <button style={btn(false)} onClick={() => { setCenter(null); setJump(''); }}>PC</button>}
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
                           background: isPc ? '#1a4a1a' : isHit ? '#4a3a00' : isMatch ? '#241c00' : wasRecent ? '#0c1d0c' : 'transparent',
                           outline: isHit ? '1px solid #ffcc00' : 'none', outlineOffset:'-1px',
                           borderLeft: `2px solid ${isPc ? C.textBright : isHit ? '#ffcc00' : 'transparent'}`}}>
                <span style={{width:'10px',color: hasBp ? (conds[r.a] ? C.amber : C.red) : C.textDim}}>{hasBp ? '●' : isOff ? '○' : ''}</span>
                <span style={{color: isPc ? C.textBright : '#77aa77',width:'34px'}}>{hx(r.a, cpu === 'dme' ? 4 : 3)}</span>
                <span style={{color:C.amber,width:`${colW.label}ch`,flex:'none',overflow:'hidden',textOverflow:'ellipsis'}} title={r.label}>{isMatch ? markLabel(r.label) : r.label}</span>
                <span style={{color:C.textBright,width:'5ch',flex:'none'}}>{r.instr}</span>
                <span style={{color:C.textDim,width:`${colW.ops}ch`,flex:'none'}}>{r.ops}</span>
                <span style={{color: running ? '#557799' : C.blue,width:'22ch',flex:'none',overflow:'hidden',textOverflow:'ellipsis'}}
                      title={val && `${val}  (as this instruction last ran, before it executed)`}>{val}</span>
                <span style={{color:'#557755',width:'9ch',flex:'none',overflow:'hidden'}}>{r.bytes}</span>
              </div>
            );
          })}
        </div>
      )}
      <TraceList cpu={cpu} trace={running ? [] : trace} traceCtx={traceCtx} listing={listing} colW={colW} running={running}
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
function TraceList({ cpu, trace, traceCtx, listing, colW, running, onJump }) {
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
                  <span style={{color:C.textDim,width:`${colW.ops}ch`,flex:'none'}}>{r.ops}</span>
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

function SnapshotPanel({ live, running }) {
  const { connected, snapshots = [], snapCfg, loadedSnap, snapBusy, send, loadSnapshot, addTestSnapshot, deleteSnapshot, downloadSnapshot, uploadSnapshot, snapshotDetail } = live;
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
                  {s.roms?.dme?.name ?? '--'} · {s.roms?.klr?.name ?? '--'}
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
              {detail?.id === s.id && (detail.data.kind === 'test' ? <TestSnapshotDetail d={detail.data} /> : <SnapshotDetail d={detail.data} />)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// A regression test's warning (test_snap.py): what LOAD will build and run
function TestSnapshotDetail({ d }) {
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
      {row('DME ROM', d.roms?.dme ?? '--')}
      {row('KLR ROM', d.roms?.klr ?? '--')}
      {row('log', d.log ?? '--')}
      {row('build', d.built ? 'ready (obj/tests/' + d.test + ')' : 'not built yet: LOAD builds it first')}
    </div>
  );
}

function SnapshotDetail({ d }) {
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
    return `${m?.name ?? r?.path ?? '--'}  sha256 ${short(m?.sha256)}…  crc32 ${r?.crc32 ?? '--'}  ${m?.workbook ? `listing ${m.workbook}` : 'no workbook'}`;
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
