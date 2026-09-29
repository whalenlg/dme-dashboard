import { useState, useMemo, useEffect } from "react";

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
  { k:'boost',     label:'BOOST MAP (KLR ch4)', auto:true, pin:0x85, hint:'auto = MAP-table model · 85 nominal' },
  { k:'fuel_qual', label:'FQS (ch7)',    positions:[0x00,0x3B,0x5A,0x75,0x81,0x91,0x9C,0xA7],
    hint:'switch position (ch7 raw 00…A7, as the FQS0..7 tests); also scales model fuel energy' },
  { k:'coolant',   label:'COOLANT (ch3)', hint:'20 warm · 68 ≈5°C · 00 shorted' },
  { k:'airtemp',   label:'AIR TEMP (ch2)', hint:'50 nominal · 00 shorted' },
  { k:'battery',   label:'BATTERY (ch1)', hint:'V ≈ raw×0.0526+2.13', volts:true },
  { k:'altitude',  label:'ALTITUDE (ch4)', positions:[0xF8,0x00], names:['under 1000 m','over 1000 m'],
    hint:'ch4 raw F8 / 00, as TEST_IDLE_HIGH_ALT' },
];

const btn = (on, col = C.textBright) => ({
  padding:'4px 10px', background: on ? '#0d4a0d' : C.panelBg2, border:`1px solid ${on ? col : C.border}`,
  color: on ? col : C.textDim, fontFamily:'inherit', fontSize:'10px', letterSpacing:'0.08em', cursor:'pointer',
});
const inp = { background:'#030803', border:`1px solid ${C.border}`, color:C.textBright, fontFamily:'inherit',
              fontSize:'10px', padding:'3px 5px' };
const panel = { background:C.panelBg, border:`1px solid ${C.border}`, borderRadius:'2px', padding:'8px 10px' };
const title = { color:C.textDim, fontSize:'9px', letterSpacing:'0.2em', textTransform:'uppercase', marginBottom:'6px' };

export default function LivePanel({ live, url, follow, setFollow, onClose }) {
  const { connected, sim, inputs, bps, trace, error, asm, send, restart } = live;
  const [stepN, setStepN]   = useState(1);
  const [untilMs, setUntil] = useState('');
  const running = sim.state === 'running';
  const stopKey = running ? null : `${sim.tNs}:${sim.reason}`;

  // Ask for the instruction trace whenever the sim stops
  useEffect(() => {
    if (sim.state === 'paused') send('trace dme 32\ntrace klr 32');
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
      {error && <div style={{...panel,color:C.red,fontSize:'11px'}}>
        {error}{!connected && <> — start it with <code>node dme_klr/live/bridge.mjs</code> in 944turbo_dme_klr ({url})</>}
      </div>}

      <div style={{display:'grid',gridTemplateColumns:'minmax(280px,1fr) minmax(300px,1.2fr) minmax(300px,1.2fr)',gap:'8px'}}>
        <InputsPanel inputs={inputs} send={send} />
        <AsmPanel cpu="dme" name="DME 8051" listing={asm.dme} pc={sim.dmePc} bps={bps.dme} trace={trace.dme}
                  running={running} stopKey={stopKey} send={send} />
        <AsmPanel cpu="klr" name="KLR 8048" listing={asm.klr} pc={sim.klrPc} bps={bps.klr} trace={trace.klr}
                  running={running} stopKey={stopKey} send={send} />
      </div>
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
const WINDOW = 18;   // rows shown above and below the centre line

// Nearest row at or before an address (pc can sit mid-instruction while running)
function rowFor(listing, a) {
  if (a == null || !listing.length) return 0;
  let lo = 0, hi = listing.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (listing[mid].a <= a) lo = mid; else hi = mid - 1; }
  return lo;
}

function AsmPanel({ cpu, name, listing, pc, bps, trace, running, stopKey, send }) {
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

  const bpSet = useMemo(() => new Set(bps), [bps]);
  const recent = useMemo(() => new Set(trace.slice(-16)), [trace]);
  const c = rowFor(listing, center ?? pc);
  const rows = listing.slice(Math.max(0, c - WINDOW), c + WINDOW);

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
      {bps.length > 0 && (
        <div style={{display:'flex',gap:'4px',flexWrap:'wrap',alignItems:'center',fontSize:'10px',marginBottom:'4px'}}>
          <span style={{color:C.textDim}}>BREAKPOINTS</span>
          {bps.map(a => {
            const lbl = listing.length ? listing[rowFor(listing, a)] : null;
            return (
              <span key={a} style={{display:'inline-flex',border:`1px solid ${C.border}`,background:C.panelBg2}}>
                <span style={{color:C.red,padding:'1px 5px',cursor:'pointer'}} title="Show in listing"
                      onClick={() => { setCenter(a); setJump(hx(a, 4)); }}>
                  ● {hx(a, cpu === 'dme' ? 4 : 3)}{lbl?.a === a && lbl.label ? ` ${lbl.label}` : ''}
                </span>
                <span style={{color:C.textDim,padding:'1px 5px',cursor:'pointer',borderLeft:`1px solid ${C.border}`}}
                      title="Remove breakpoint" onClick={() => send(`bp del ${cpu} ${hx(a, 4)}`)}>✕</span>
              </span>
            );
          })}
          {bps.length > 1 && (
            <button style={btn(false, C.red)} onClick={() => send(bps.map(a => `bp del ${cpu} ${hx(a, 4)}`).join('\n'))}>
              CLEAR ALL
            </button>
          )}
        </div>
      )}
      {!listing.length ? (
        <div style={{color:C.textDim,fontSize:'10px',padding:'20px'}}>No disassembly from the bridge.</div>
      ) : (
        <div style={{fontSize:'10.5px',lineHeight:'15px',overflow:'hidden',whiteSpace:'nowrap'}}>
          {rows.map(r => {
            const isPc = r.a === pc && !running, hasBp = bpSet.has(r.a), wasRecent = recent.has(r.a);
            return (
              <div key={r.a} title="Click to toggle a breakpoint"
                   onClick={() => send(`bp ${hasBp ? 'del' : 'add'} ${cpu} ${hx(r.a, 4)}`)}
                   style={{display:'flex',gap:'8px',cursor:'pointer',padding:'0 4px',
                           background: isPc ? '#1a4a1a' : wasRecent ? '#0c1d0c' : 'transparent',
                           borderLeft: `2px solid ${isPc ? C.textBright : 'transparent'}`}}>
                <span style={{width:'10px',color:C.red}}>{hasBp ? '●' : ''}</span>
                <span style={{color: isPc ? C.textBright : '#77aa77',width:'34px'}}>{hx(r.a, cpu === 'dme' ? 4 : 3)}</span>
                <span style={{color:C.amber,width:'110px',overflow:'hidden',textOverflow:'ellipsis'}}>{r.label}</span>
                <span style={{color:C.textBright,width:'40px'}}>{r.instr}</span>
                <span style={{color:C.textDim,flex:1,overflow:'hidden',textOverflow:'ellipsis'}}>{r.ops}</span>
                <span style={{color:'#557755',width:'64px'}}>{r.bytes}</span>
              </div>
            );
          })}
        </div>
      )}
      {!running && trace.length > 0 && (
        <div style={{color:'#779977',fontSize:'9px',marginTop:'6px',whiteSpace:'normal',wordBreak:'break-all'}}>
          last {trace.length}: {trace.map(a => hx(a, cpu === 'dme' ? 4 : 3)).join(' ')}
        </div>
      )}
    </div>
  );
}
