import { useState, useMemo, useEffect } from "react";

// ─────────────────────────────────────────────────────────────────
//  PERFORMANCE (live mode): time spent in each routine of one CPU
//  From the sim's routine profiler (sim_main's prof.h, SIM: [PROF] lines,
//  parseProf in liveSim.js): every CALL until its RET, and every interrupt
//  from its vector until RETI (DME) / RETR (KLR), with a call stack so
//  that nesting and interrupts inside calls are counted where they belong.
//  It keeps counting while the sim runs (an update about once a second and
//  at each stop); RESET starts the counts again.
// ─────────────────────────────────────────────────────────────────

// Palette mirrors C in App.jsx
const C = {
  panelBg:'#060e06', panelBg2:'#0a150a', border:'#0d2e0d', border2:'#1a3a1a',
  text:'#00e060', textDim:'#ccddcc', textBright:'#00ff80', amber:'#ffaa00', red:'#ff4444', blue:'#44aaff',
};
const hx = (v, n = 4) => v == null || isNaN(v) ? '--' : v.toString(16).toUpperCase().padStart(n, '0');
const btn = (on, col = C.textBright) => ({
  padding:'4px 10px', background: on ? '#0d4a0d' : C.panelBg2, border:`1px solid ${on ? col : C.border}`,
  color: on ? col : C.textDim, fontFamily:'inherit', fontSize:'10px', letterSpacing:'0.08em', cursor:'pointer',
});
const inp = { background:'#030803', border:`1px solid ${C.border}`, color:C.textBright, fontFamily:'inherit',
              fontSize:'10px', padding:'3px 5px' };
const panel = { background:C.panelBg, border:`1px solid ${C.border}`, borderRadius:'2px', padding:'8px 10px' };

// A time in ns as µs (or ms once it's long), a cycle count as it is
const fmtUs = ns => {
  if (ns == null || !isFinite(ns)) return '--';
  const us = ns / 1000;
  return us >= 10000 ? `${(us / 1000).toFixed(2)} ms` : us >= 100 ? us.toFixed(0) : us.toFixed(1);
};
const fmtCyc = c => c == null || !isFinite(c) ? '--' : c >= 100 ? Math.round(c).toLocaleString() : (Math.round(c * 10) / 10).toString();

// The label of a routine's entry: the listing's label there, else the
// nearest one before it ("label+3"), else nothing
function labelFor(listing, a) {
  if (!listing?.length) return '';
  let lo = 0, hi = listing.length - 1, at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (listing[mid].a <= a) { at = mid; lo = mid + 1; } else hi = mid - 1;
  }
  for (let i = at; i >= 0 && listing[i].a > a - 0x400; i--)
    if (listing[i].label) return listing[i].a === a ? listing[i].label : `${listing[i].label}+${(a - listing[i].a).toString(16).toUpperCase()}`;
  return '';
}

const COLS = [
  { k:'kind',  h:'KIND',   title:'INT: an interrupt, from its vector to RETI / RETR. CALL: a subroutine, from CALL to RET', left:true },
  { k:'a',     h:'ADDR',   title:'Entry address (the interrupt vector, or the CALL target)', left:true },
  { k:'label', h:'ROUTINE', title:'The disassembly label at the entry (as in the CODE window)', left:true },
  { k:'n',     h:'CALLS',  title:'How many times it ran to its return since the profile started' },
  { k:'min',   h:'MIN',    title:'Shortest run' },
  { k:'avg',   h:'AVG',    title:'Mean run' },
  { k:'max',   h:'MAX',    title:'Longest run' },
  { k:'sum',   h:'TOTAL',  title:'All its runs together' },
  { k:'pct',   h:'% TIME', title:'TOTAL as a share of the time profiled (calls include the routines they call, so these overlap)' },
];

export default function PerfPanel({ cpu, prof, listing, sim, connected, send }) {
  const running = sim.state === 'running';
  const [unit, setUnit] = useState('us');      // us | cyc
  const [excl, setExcl] = useState(true);      // time less the interrupts taken inside
  const [kind, setKind] = useState('all');     // all | i | c
  const [q, setQ] = useState('');
  const [sort, setSort] = useState({ k: 'sum', dir: -1 });

  // Opened while paused: ask for the profile so far
  useEffect(() => { if (connected && !prof) send(`prof ${cpu}`); }, [connected, prof, cpu, send]);

  const span = prof ? Math.max(0, prof.tNs - prof.since) : 0;
  const rows = useMemo(() => {
    if (!prof) return [];
    const t = q.trim().toLowerCase();
    const out = prof.rows.filter(r => kind === 'all' || (kind === 'i') === r.irq).map(r => {
      const s = unit === 'cyc' ? r.c : excl ? r.x : r.t;
      // % of time: from the time stats either way (cycles track them)
      const tsum = excl ? r.x.sum : r.t.sum;
      return { ...r, label: labelFor(listing, r.a), min: s.min, avg: s.avg, max: s.max, sum: s.sum,
               pct: span > 0 ? 100 * tsum / span : null, kind: r.irq ? 'INT' : 'CALL' };
    }).filter(r => !t || r.label.toLowerCase().includes(t) || hx(r.a).toLowerCase().includes(t));
    const { k, dir } = sort;
    out.sort((a, b) => {
      const va = a[k], vb = b[k];
      const c = typeof va === 'string' ? va.localeCompare(vb) : (va ?? -1) - (vb ?? -1);
      return c * dir || a.a - b.a;
    });
    return out;
  }, [prof, listing, unit, excl, kind, q, sort, span]);

  const fmt = v => unit === 'cyc' ? fmtCyc(v) : fmtUs(v);
  // TOTAL: ms (it soon runs past what µs shows well)
  const fmtTotal = v => unit === 'cyc' ? fmtCyc(v) : v == null || !isFinite(v) ? '--' : (v / 1e6).toFixed(v < 1e7 ? 3 : 1);
  const colUnit = k => k === 'sum' ? (unit === 'cyc' ? 'CYC' : 'ms') : unit === 'cyc' ? 'CYC' : 'µs';
  const irqLoad = prof && span > 0 ? 100 * prof.rows.filter(r => r.irq).reduce((s, r) => s + r.x.sum, 0) / span : null;
  // A column heading sorts by it (again: the other way); text ascending, numbers largest first
  const head = k => () => setSort(s => s.k === k ? { k, dir: -s.dir } : { k, dir: ['kind', 'a', 'label'].includes(k) ? 1 : -1 });
  const cell = { padding:'2px 8px', whiteSpace:'nowrap', textAlign:'right', fontVariantNumeric:'tabular-nums' };
  const unitName = unit === 'cyc' ? 'machine cycles' : 'µs';

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'8px',textAlign:'left'}}>
      <div style={{...panel,display:'flex',gap:'10px',alignItems:'center',flexWrap:'wrap',fontSize:'10px'}}>
        <span style={{color: !connected ? C.red : running ? C.textBright : C.amber, fontSize:'11px'}}>
          ● {!connected ? 'OFFLINE' : sim.state.toUpperCase()}
        </span>
        <span style={{color:C.textDim}}>
          {prof ? <>profiled {(span / 1e6).toFixed(1)} ms (t={(prof.since / 1e6).toFixed(1)} → {(prof.tNs / 1e6).toFixed(1)} ms)
                   · {prof.rows.length} routines
                   {irqLoad != null && <> · <span style={{color:C.amber}} title="Time in interrupt service routines (less the interrupts they were interrupted by), as a share of the time profiled">interrupts {irqLoad.toFixed(1)}% of the CPU</span></>}</>
                : connected ? 'no profile yet: RUN the sim' : 'not connected'}
        </span>
        <span style={{flex:1}} />
        <button style={btn(false, C.amber)} disabled={!connected} onClick={() => send(`prof reset ${cpu}`)}
                title="Start the counts again from now (calls in progress are counted when they return)">↺ RESET</button>
        <button style={btn(false)} disabled={!connected || running} onClick={() => send(`prof ${cpu}`)}
                title="Ask the sim for the profile now (while running it updates about once a second by itself)">⟳ REFRESH</button>
      </div>

      <div style={{...panel,display:'flex',gap:'10px',alignItems:'center',flexWrap:'wrap',fontSize:'10px',color:C.textDim}}>
        <span>SHOW</span>
        {[['all','ALL'],['i','INTERRUPTS'],['c','CALLS']].map(([k, h]) =>
          <button key={k} style={btn(kind === k)} onClick={() => setKind(k)}>{h}</button>)}
        <span style={{marginLeft:'8px'}}>UNITS</span>
        <button style={btn(unit === 'us')} onClick={() => setUnit('us')} title="Simulated time">µs</button>
        <button style={btn(unit === 'cyc')} onClick={() => setUnit('cyc')}
                title={cpu === 'dme' ? '8051 machine cycles (12 oscillator clocks each)' : '8048 machine cycles (15 oscillator clocks each)'}>CYCLES</button>
        <label style={{display:'inline-flex',alignItems:'center',gap:'4px',cursor: unit === 'cyc' ? 'default' : 'pointer',opacity: unit === 'cyc' ? 0.45 : 1}}
               title="Leave out the time spent in interrupts taken while the routine ran (so each interrupt's time is charged to the interrupt). Cycles always include them">
          <input type="checkbox" checked={excl} disabled={unit === 'cyc'} onChange={e => setExcl(e.target.checked)} />
          less interrupts inside
        </label>
        <span style={{flex:1}} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="label or hex" style={{...inp,width:'130px'}}
               title="Show only the routines whose label or address contains this" />
      </div>

      <div style={{...panel,padding:'4px 0',overflowX:'auto'}}>
        <table style={{borderCollapse:'collapse',width:'100%',fontSize:'11px'}}>
          <thead>
            <tr style={{color:C.textDim,fontSize:'9px',letterSpacing:'0.1em',borderBottom:`1px solid ${C.border2}`}}>
              {COLS.map(c => (
                <th key={c.k} onClick={head(c.k)} title={`${c.title}${['min','avg','max','sum'].includes(c.k) ? ` (${c.k === 'sum' && unit !== 'cyc' ? 'ms' : unitName})` : ''} · click to sort`}
                    style={{...cell,textAlign:c.left ? 'left' : 'right',cursor:'pointer',userSelect:'none',fontWeight:'normal',
                            color: sort.k === c.k ? C.textBright : C.textDim}}>
                  {c.h}{['min','avg','max','sum'].includes(c.k) ? ` ${colUnit(c.k)}` : ''}{sort.k === c.k ? (sort.dir < 0 ? ' ▼' : ' ▲') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={`${r.kind}${r.a}`} style={{borderBottom:`1px solid ${C.panelBg2}`}}>
                <td style={{...cell,textAlign:'left',color: r.irq ? C.amber : C.blue}}>{r.kind}</td>
                <td style={{...cell,textAlign:'left',color:C.textDim}}>{hx(r.a, cpu === 'dme' ? 4 : 3)}</td>
                <td style={{...cell,textAlign:'left',color:C.amber,maxWidth:'260px',overflow:'hidden',textOverflow:'ellipsis'}} title={r.label}>{r.label || <span style={{color:'#557755'}}>(no label)</span>}</td>
                <td style={{...cell,color:C.textBright}}>{r.n.toLocaleString()}</td>
                <td style={cell}>{fmt(r.min)}</td>
                <td style={cell}>{fmt(r.avg)}</td>
                <td style={{...cell,color: r.max > 2 * r.avg ? C.amber : undefined}}>{fmt(r.max)}</td>
                <td style={cell}>{fmtTotal(r.sum)}</td>
                <td style={{...cell,minWidth:'90px'}}>
                  {r.pct == null ? '--' : (
                    <span style={{display:'inline-flex',alignItems:'center',gap:'6px',justifyContent:'flex-end',width:'100%'}}>
                      <span style={{display:'inline-block',height:'6px',width:`${Math.min(50, r.pct / 2)}px`,background: r.irq ? C.amber : C.blue,opacity:0.7}} />
                      {r.pct.toFixed(r.pct < 10 ? 2 : 1)}
                    </span>)}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={COLS.length} style={{...cell,textAlign:'center',color:C.textDim,padding:'12px'}}>
              {prof?.rows.length ? 'nothing matches' : 'no routine has returned yet'}</td></tr>}
          </tbody>
        </table>
      </div>

      {prof && <div style={{color:'#779977',fontSize:'9px',lineHeight:1.5}}>
        A routine is timed from its first instruction to the instruction it returns to; one still running (the main loop,
        a call in progress) is counted once it returns. Call stack now {prof.depth} deep (deepest {prof.maxDepth})
        {prof.unmatched > 0 && <> · {prof.unmatched.toLocaleString()} returns matched no call (a computed jump through PUSH / RET, or a call made before the profile started)</>}
        {prof.dropped > 0 && <> · {prof.dropped.toLocaleString()} calls left without a return (not counted)</>}.
      </div>}
    </div>
  );
}
