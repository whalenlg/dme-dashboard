import { useState, useMemo, useEffect, useLayoutEffect, useRef, memo } from "react";
import { fmtBoost } from "./boost.js";
import { thin, syncNearest, inRange } from "./thin.js";
import { useZoom, zoomHandlers, ZoomBox, DragArea, ZoomBar } from "./zoom.jsx";
import { dmeOperandValues, klrOperandValues, decodeStack, cameFrom, traceState, STACK } from "./asmValues.js";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

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

export default function LivePanel({ live, url, follow, setFollow, series, mem, onClose }) {
  const { connected, sim, inputs, bps, trace, traceCtx, error, asm, asmSrc, regs, roms, send, restart, loadRom } = live;
  const [stepN, setStepN]   = useState(1);
  const [untilMs, setUntil] = useState('');
  const running = sim.state === 'running';
  const stopKey = running ? null : `${sim.tNs}:${sim.reason}`;

  // Ask for the instruction trace whenever the sim stops
  useEffect(() => {
    if (sim.state === 'paused') send('trace dme 512\ntrace klr 512');   // all the sim keeps
  }, [sim.state, sim.tNs, send]);

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
        {!running && sim.reason && <span style={{color:C.amber,fontSize:'10px'}}>stopped: {sim.reason}</span>}
        <span style={{flex:1}} />
        <button style={btn(running)} onClick={() => send('run')} disabled={running}>▶ RUN</button>
        <button style={btn(!running, C.amber)} onClick={() => send('pause')} disabled={!running}>⏸ PAUSE</button>
        <input type="number" min={1} value={stepN} onChange={e => setStepN(Math.max(1, +e.target.value || 1))}
               style={{...inp,width:'46px'}} title="Instructions per step" />
        <button style={btn(false)} disabled={running} onClick={() => send(`step dme ${stepN}`)}>STEP DME</button>
        <button style={btn(false)} disabled={running} onClick={() => send(`step klr ${stepN}`)}>STEP KLR</button>
        <input value={untilMs} onChange={e => setUntil(e.target.value)} placeholder="ms" style={{...inp,width:'56px'}}
               onKeyDown={e => e.key === 'Enter' && untilMs && send(`until ${untilMs}`)} />
        <button style={btn(false)} disabled={running || !untilMs} onClick={() => send(`until ${untilMs}`)}>RUN TO</button>
        <button style={btn(false, C.red)} onClick={restart} title="Kill the sim and start again at t=0">↺ RESTART</button>
        <label style={{color:C.textDim,fontSize:'10px',cursor:'pointer'}}>
          <input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} /> FOLLOW
        </label>
        <button style={btn(false)} onClick={onClose}>✕ DISCONNECT</button>
      </div>
      <RomRow roms={roms} asmSrc={asmSrc} paused={connected && sim.state === 'paused'} loadRom={loadRom} />
      <SnapshotPanel live={live} running={running} />
      {error && <div style={{...panel,color:C.red,fontSize:'11px'}}>
        {error}{!connected && <> — start it with <code>node dme_klr/live/bridge.mjs</code> in 944turbo_dme_klr ({url})</>}
      </div>}

      {/* Sim inputs | live engine stats | DME + KLR debuggers */}
      <div className="live-cols">
        <InputsPanel inputs={inputs} send={send} />
        <div style={{display:'flex',flexDirection:'column',gap:'8px',minWidth:0}}>
          <EngineRow series={series} />
          {live.warnings.length > 0 && (
            <div style={{...panel,borderColor:C.red,fontSize:'10px',maxHeight:'90px',overflowY:'auto'}}>
              <div style={{...title,color:C.red,marginBottom:'3px'}}>SIM WARNINGS ({live.warnings.length})</div>
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
        </div>
        {/* Side by side when there is room for full operands, else stacked */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(520px,100%),1fr))',gap:'8px',alignItems:'start',minWidth:0}}>
          <AsmPanel cpu="dme" name="DME 8051" listing={asm.dme} pc={sim.dmePc} bps={bps.dme} trace={trace.dme} traceCtx={traceCtx?.dme}
                    ram={mem?.dme} regs={regs?.dme} running={running} stopKey={stopKey} send={send} />
          <AsmPanel cpu="klr" name="KLR 8048" listing={asm.klr} pc={sim.klrPc} bps={bps.klr} trace={trace.klr} traceCtx={traceCtx?.klr}
                    ram={mem?.klr} regs={regs?.klr} running={running} stopKey={stopKey} send={send} />
        </div>
      </div>
    </div>
  );
}

// ── ROM images: what each EPROM holds, and loading another .mem ──
function RomRow({ roms, asmSrc, paused, loadRom }) {
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
    </div>
  );
}

// ── Engine values: latest DS snapshot, plus a chart per metric ──
const hexv = v => v == null ? '--' : `0x${hx(v)}`;
const METRICS = [
  { k:'rpm',    label:'RPM',          col:'#66ffaa', fmt: v => v ?? '--' },
  { k:'inj',    label:'INJ PULSE',    col:'#aaffaa', unit:'ms', step:true, overlay:'injHeldMs', warn: p => p?.injHeld || p?.injDuty >= 100,
    fmt: (v, p) => p?.fuelCut ? 'CUT' : p?.injHeld ? 'HELD OPEN' : v == null ? '--'
      : `${v.toFixed(2)} ms${p?.injDuty >= 100 ? ' HELD OPEN' : p?.injDuty != null ? ` ${p.injDuty}%` : ''}` },
  { k:'fuel',   label:'FUEL CMD 4A:4B', col:'#77bb77', unit:'ms', warn: p => p?.injOver,
    fmt: (v, p) => v == null ? '--' : `${v.toFixed(3)} ms${p?.injOver ? ' > 1 REV' : ''}` },
  { k:'afm',    label:'AFM RAW',      col:'#44cccc', hex:true, fmt: hexv },
  { k:'tps',    label:'TPS',          col:'#88ccff', hex:true, fmt: hexv },
  { k:'load',   label:'LOAD',         col:'#ffcc66', hex:true, fmt: hexv },
  { k:'boost',  label:'BOOST',        col:'#ffaa00', unit:'psi', fmt: fmtBoost },
  { k:'dmeIgn', label:'DME SPARK INTERVAL', col:'#ff8888', unit:'ms', step:true, fmt: v => v == null ? '--' : `${v.toFixed(2)} ms` },
  { k:'klrIgn', label:'KLR IGN PULSE', col:'#ff66cc', unit:'ms', step:true, fmt: v => v == null ? '--' : `${v.toFixed(2)} ms` },
];

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
                   labelFormatter={v => `${v} ms`} formatter={v => [m.fmt(v), m.label]} />
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
      <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
        {METRICS.map(m => (
          <span key={m.k} style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:'12px'}}>
            <span style={{color:C.textDim,fontSize:'9px',letterSpacing:'0.15em'}}>{m.label}</span>
            <span style={{color: m.warn?.(last) ? C.red : m.col,fontFamily:"'Orbitron',monospace",fontSize:'14px'}}>{m.fmt(last?.[m.k], last)}</span>
          </span>
        ))}
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
  const commit = (k, v) => {
    setDraft(d => { const n = { ...d }; delete n[k]; return n; });
    send(`set ${k} ${v}`);
  };
  return (
    <div style={panel}>
      <div style={title}>SIM INPUTS</div>
      {INPUTS.map(d => {
        const cur = inputs[d.k];
        const isAuto = cur === 'auto';
        const val = draft[d.k] ?? (isAuto ? null : cur);
        const max = d.max ?? 255, min = d.min ?? 0;
        return (
          <div key={d.k} style={{marginBottom:'6px'}}>
            <div style={{display:'flex',gap:'6px',alignItems:'center',fontSize:'10px'}}>
              <span style={{color:C.textDim,width:'118px'}}>{d.label}</span>
              <span style={{color:isAuto ? C.blue : C.textBright,minWidth:'70px'}}>
                {isAuto && draft[d.k] == null ? 'AUTO'
                  : val == null ? '--'
                  : d.dec ? val
                  : d.positions ? (d.positions.includes(val)
                      ? `${d.names ? d.names[d.positions.indexOf(val)] : `pos ${d.positions.indexOf(val)}`} (0x${hx(val)})`
                      : `0x${hx(val)}`)
                  : `0x${hx(val)} (${val})${d.volts ? ` ${(val * 0.05263 + 2.132).toFixed(1)}V` : ''}`}
              </span>
              {d.auto && (
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
                    <input type="radio" name={d.k} checked={cur === raw} disabled={cur == null}
                           onChange={() => commit(d.k, raw)} style={{display:'none'}} />
                    {d.names ? d.names[i] : i}
                  </label>
                ))}
              </div>
            ) : (
            <input type="range" min={min} max={max} step={d.step ?? 1} value={val ?? min}
                   disabled={cur == null}
                   onChange={e => setDraft(dr => ({ ...dr, [d.k]: +e.target.value }))}
                   onPointerUp={e => commit(d.k, e.target.value)}
                   onKeyUp={e => commit(d.k, e.target.value)}
                   style={{width:'100%',accentColor: isAuto ? C.blue : '#00cc66',opacity: isAuto ? 0.5 : 1}} />
            )}
            {d.hint && <div style={{color:'#779977',fontSize:'8px'}}>{d.hint}</div>}
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
const CODE_ROWS = 32;    // listing rows visible at once
const WINDOW    = 64;    // rows rendered above and below the centre line (scrollable)
const STACK_H   = 140;   // px
const TRACE_ROWS = 16;   // trace rows visible at once

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

function AsmPanel({ cpu, name, listing, pc, bps, trace, traceCtx, ram, regs, running, stopKey, send }) {
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

  // Disabled breakpoints are removed from the sim but stay listed here
  const [disabled, setDisabled] = useState([]);
  const bpSet = useMemo(() => new Set(bps), [bps]);
  const offSet = useMemo(() => new Set(disabled.filter(a => !bpSet.has(a))), [disabled, bpSet]);
  const allBps = useMemo(() => [...new Set([...bps, ...offSet])].sort((x, y) => x - y), [bps, offSet]);
  const bpCmd = (op, a) => `bp ${op} ${cpu} ${hx(a, 4)}`;
  const setEnabled = (a, on) => {
    send(bpCmd(on ? 'add' : 'del', a));
    setDisabled(d => on ? d.filter(x => x !== a) : [...d.filter(x => x !== a), a]);
  };
  const removeBp = a => {
    if (bpSet.has(a)) send(bpCmd('del', a));
    setDisabled(d => d.filter(x => x !== a));
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
  useLayoutEffect(() => {
    const row = codeRef.current?.children[c - first];
    if (row) codeRef.current.scrollTop = row.offsetTop - (codeRef.current.clientHeight - ROW_H) / 2;
  }, [c, first, listing]);

  const doJump = () => {
    const q = jump.trim();
    if (!q) { setCenter(null); return; }
    const byLabel = listing.find(r => r.label.toLowerCase() === q.toLowerCase())
                 ?? listing.find(r => r.label.toLowerCase().includes(q.toLowerCase()));
    const a = byLabel ? byLabel.a : parseInt(q, 16);
    if (!isNaN(a)) setCenter(a);
  };

  return (
    <div style={{...panel,display:'flex',flexDirection:'column',minWidth:0}}>
      <div style={{...title,display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
        <span>{name}</span>
        <span style={{color:C.textBright,letterSpacing:'0.05em'}}>PC {hx(pc, cpu === 'dme' ? 4 : 3)}</span>
        {routine && <span style={{color:C.amber,textTransform:'none',letterSpacing:0}}>in {routine}</span>}
        <span style={{marginLeft:'auto',display:'inline-flex',gap:'4px',textTransform:'none',letterSpacing:0}}>
          <input value={jump} onChange={e => setJump(e.target.value)} onKeyDown={e => e.key === 'Enter' && doJump()}
                 placeholder="label or hex" style={{...inp,width:'90px'}} />
          <button style={btn(false)} onClick={doJump}>GO</button>
          {center != null && <button style={btn(false)} onClick={() => { setCenter(null); setJump(''); }}>PC</button>}
        </span>
      </div>
      {allBps.length > 0 && (
        <div style={{display:'flex',gap:'4px',flexWrap:'wrap',alignItems:'center',fontSize:'10px',marginBottom:'4px'}}>
          <span style={{color:C.textDim}}>BREAKPOINTS</span>
          {allBps.map(a => {
            const lbl = listing.length ? listing[rowFor(listing, a)] : null;
            const on = bpSet.has(a);
            return (
              <span key={a} style={{display:'inline-flex',alignItems:'center',border:`1px solid ${C.border}`,background:C.panelBg2}}>
                <input type="checkbox" checked={on} title={on ? 'Disable breakpoint' : 'Enable breakpoint'}
                       onChange={e => setEnabled(a, e.target.checked)}
                       style={{margin:'0 2px 0 4px',accentColor:C.red,cursor:'pointer'}} />
                <span style={{color: on ? C.red : C.textDim,padding:'1px 5px 1px 2px',cursor:'pointer'}} title="Show in listing"
                      onClick={() => { setCenter(a); setJump(hx(a, 4)); }}>
                  {on ? '●' : '○'} {hx(a, cpu === 'dme' ? 4 : 3)}{lbl?.a === a && lbl.label ? ` ${lbl.label}` : ''}
                </span>
                <span style={{color:C.textDim,padding:'1px 5px',cursor:'pointer',borderLeft:`1px solid ${C.border}`}}
                      title="Remove breakpoint" onClick={() => removeBp(a)}>✕</span>
              </span>
            );
          })}
          {allBps.length > 1 && (
            <button style={btn(false, C.red)} onClick={() => { send(bps.map(a => bpCmd('del', a)).join('\n')); setDisabled([]); }}>
              CLEAR ALL
            </button>
          )}
        </div>
      )}
      <CameFrom cpu={cpu} trace={running ? [] : trace} listing={listing}
                onJump={a => { setCenter(a); setJump(hx(a, 4)); }} />
      <StackView cpu={cpu} ram={ram} regs={regs} listing={listing} running={running}
                 onJump={a => { setCenter(a); setJump(hx(a, 4)); }} />
      {!listing.length ? (
        <div style={{color:C.textDim,fontSize:'10px',padding:'20px',height:`${CODE_ROWS * ROW_H}px`,boxSizing:'border-box'}}>No disassembly from the bridge.</div>
      ) : (
        <div ref={codeRef} style={{fontSize:'10.5px',lineHeight:`${ROW_H}px`,height:`${CODE_ROWS * ROW_H}px`,flex:'none',position:'relative',
                                   overflow:'auto',whiteSpace:'nowrap',border:`1px solid ${C.border}`}}>
          {rows.map(r => {
            const isPc = r.a === pc && !running, hasBp = bpSet.has(r.a), wasRecent = recent.has(r.a);
            const isOff = offSet.has(r.a);
            // Values as this instruction saw them (blank if it isn't in the trace)
            const st = running ? null : traceState(cpu, lastCtx.get(r.a), r);
            const val = st ? (cpu === 'dme' ? dmeOperandValues : klrOperandValues)(r, st.ram, st.regs) : '';
            return (
              <div key={r.a} title={`${r.desc ? `${r.desc}\n\n` : ''}Click to toggle a breakpoint`}
                   onClick={() => hasBp ? removeBp(r.a) : isOff ? setEnabled(r.a, true) : send(bpCmd('add', r.a))}
                   style={{display:'flex',gap:'8px',cursor:'pointer',padding:'0 4px',textAlign:'left',height:`${ROW_H}px`,
                           width:'max-content',minWidth:'100%',boxSizing:'border-box',
                           background: isPc ? '#1a4a1a' : wasRecent ? '#0c1d0c' : 'transparent',
                           borderLeft: `2px solid ${isPc ? C.textBright : 'transparent'}`}}>
                <span style={{width:'10px',color: hasBp ? C.red : C.textDim}}>{hasBp ? '●' : isOff ? '○' : ''}</span>
                <span style={{color: isPc ? C.textBright : '#77aa77',width:'34px'}}>{hx(r.a, cpu === 'dme' ? 4 : 3)}</span>
                <span style={{color:C.amber,width:`${colW.label}ch`,flex:'none',overflow:'hidden',textOverflow:'ellipsis'}} title={r.label}>{r.label}</span>
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
    <div style={{marginTop:'6px',borderTop:`1px solid ${C.border}`,paddingTop:'4px'}}>
      <div style={{...title,display:'flex',gap:'8px',alignItems:'center',marginBottom:'2px',cursor:'pointer'}}
           onClick={() => setOpen(o => !o)} title={open ? 'Hide' : 'Show'}>
        <span>{open ? '▾' : '▸'} {covered ? `last ${covered} executed` : 'recent instructions'}</span>
        <span style={{textTransform:'none',letterSpacing:0,color:'#557755'}}>
          oldest first · newest at the bottom{shown.length < covered ? ` · repeats collapsed (×N) into ${shown.length} rows` : ''}
        </span>
      </div>
      {open && (
        <div ref={listRef} style={{fontSize:'10.5px',lineHeight:`${ROW_H}px`,height:`${TRACE_ROWS * ROW_H}px`,
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
  const { connected, snapshots = [], snapCfg, loadedSnap, send, loadSnapshot, deleteSnapshot, downloadSnapshot, uploadSnapshot, snapshotDetail } = live;
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
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
  const badge = r => ({ warn: C.red, manual: C.blue, upload: C.amber }[r] ?? C.textDim);
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
        {loadedSnap && <span style={{color:C.amber}} title={loadedSnap}>running from snapshot {loadedSnap}</span>}
      </div>
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
                <button style={btn(false, C.amber)} disabled={!connected}
                        onClick={() => (!running || confirm('The simulation is running. Restart it from this snapshot?')) && loadSnapshot(s.id)}
                        title="Restart the simulator from this snapshot: same model state, inputs, breakpoints and EPROM images">LOAD</button>
                <button style={btn(detail?.id === s.id)} onClick={() => showDetail(s.id)} title="Inputs, ROM identity, registers">INFO</button>
                <button style={btn(false)} onClick={() => downloadSnapshot(s.id)} title="Download as one .dmesnap file to keep or share">⬇</button>
                <button style={btn(false, C.red)} onClick={() => confirm(`Delete snapshot ${s.id}?`) && deleteSnapshot(s.id)} title="Delete">✕</button>
              </div>
              {detail?.id === s.id && <SnapshotDetail d={detail.data} />}
            </div>
          ))}
        </div>
      )}
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
