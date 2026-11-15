import { useEffect, useMemo, useState } from 'react';

// LOAD LOG's list of the regression runs' .dash.logs, from the bridge
// (GET <bridge>/logs: $DMEKLR_TMP/dme_klr/v_dash_logs and dash_logs, newest
// first). A click opens one with onOpen(url, name, label). With no bridge
// running it says so, and BROWSE… / drag-and-drop still work.
const C = { border:'#0d2e0d', textDim:'#ccddcc', textBright:'#00ff80', text:'#00e060', faint:'#7a8a7a' };

// Which simulator wrote each folder (v_run_dashboard_tests.sh: Verilator,
// run_dashboard_tests.sh: iverilog)
const SIM = { v_dash_logs: { name:'Verilator', color:'#44aaff' }, dash_logs: { name:'iverilog', color:'#ffaa44' } };
const simOf = dir => SIM[dir] ?? { name: dir, color: C.faint };

const fmtSize = n => n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`;
const fmtDate = ms => {
  const d = new Date(ms), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function LogList({ bridge, onOpen }) {
  const [logs, setLogs] = useState(null);   // null: loading; false: no bridge
  const [filter, setFilter] = useState('');
  // Include Verilator / iverilog logs: both checked each time LOAD LOG opens
  const [include, setInclude] = useState({ v_dash_logs: true, dash_logs: true });
  const toggle = dir => setInclude(i => ({ ...i, [dir]: !i[dir] }));

  useEffect(() => {
    let live = true;
    fetch(`${bridge}/logs`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(l => { if (live) setLogs(Array.isArray(l) ? l : false); })
      .catch(() => { if (live) setLogs(false); });
    return () => { live = false; };
  }, [bridge]);

  const shown = useMemo(() => {
    if (!logs) return [];
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
    return logs.filter(l => include[l.dir] !== false && words.every(w => `${l.dir}/${l.name} ${simOf(l.dir).name}`.toLowerCase().includes(w)));
  }, [logs, filter, include]);

  const note = { color:C.faint, fontSize:'10px', margin:'0 0 12px' };
  if (logs === null) return <div style={note}>Looking for regression logs on the bridge…</div>;
  if (logs === false) return (
    <div style={note}>
      Start the bridge (<code>dme_klr/live/bridge.mjs</code>) to list the regression logs here:
      Verilator runs (<code>v_dash_logs</code>) and iverilog runs (<code>dash_logs</code>).
    </div>
  );
  if (!logs.length) return (
    <div style={note}>No .dash.log files in <code>v_dash_logs</code> or <code>dash_logs</code> yet.</div>
  );

  const open = l => onOpen(`${bridge}/logs/${l.dir}/${encodeURIComponent(l.name)}`, l.name, `${l.dir}/${l.name} (${simOf(l.dir).name})`);
  return (
    <div style={{marginBottom:'12px'}}>
      <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'5px'}}>
        <span style={{color:C.textDim,fontSize:'10px',flexShrink:0}}>Regression logs ({logs.length}):</span>
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="filter"
          aria-label="Filter the regression logs"
          style={{flex:1,minWidth:0,background:'#030803',border:`1px solid ${C.border}`,color:C.text,
                  fontFamily:'inherit',fontSize:'11px',padding:'3px 6px',outline:'none'}} />
        {Object.entries(SIM).map(([dir, sim]) => (
          <label key={dir} title={`Show the ${sim.name} runs (${dir})`}
            style={{display:'flex',alignItems:'center',gap:'4px',flexShrink:0,cursor:'pointer',
                    color:sim.color,fontSize:'10px',whiteSpace:'nowrap'}}>
            <input type="checkbox" checked={include[dir] !== false} onChange={() => toggle(dir)}
              style={{margin:0,accentColor:sim.color,cursor:'pointer'}} />
            Include {sim.name} logs
          </label>
        ))}
      </div>
      <div style={{maxHeight:'150px',overflowY:'auto',border:`1px solid ${C.border}`,background:'#030803'}}>
        {shown.map(l => (
          <div key={`${l.dir}/${l.name}`} role="button" tabIndex={0} title={`Open ${l.dir}/${l.name} (${simOf(l.dir).name} run)`}
            onClick={() => open(l)} onKeyDown={e => { if (e.key === 'Enter') open(l); }}
            style={{display:'flex',gap:'10px',padding:'3px 8px',cursor:'pointer',fontSize:'11px',lineHeight:'16px',
                    borderBottom:`1px solid ${C.border}`}}
            onMouseEnter={e => { e.currentTarget.style.background = '#0d2e0d'; }}
            onMouseLeave={e => { e.currentTarget.style.background = ''; }}>
            <span style={{color:C.textBright,flex:1,minWidth:0,textAlign:'left',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
              {l.name.replace(/\.dash\.log$/, '')}
            </span>
            <span style={{color:simOf(l.dir).color,width:'72px',flexShrink:0}}>{simOf(l.dir).name}</span>
            <span style={{color:C.faint,width:'108px',flexShrink:0}}>{fmtDate(l.mtime)}</span>
            <span style={{color:C.faint,width:'52px',flexShrink:0,textAlign:'right'}}>{fmtSize(l.size)}</span>
          </div>
        ))}
        {!shown.length && <div style={{color:C.faint,fontSize:'10px',padding:'4px 8px'}}>{
          !Object.keys(SIM).some(d => include[d] !== false) ? 'Both kinds of log are unchecked.'
          : filter ? `No log matches “${filter}”.` : 'No logs of the checked kind.'}</div>}
      </div>
    </div>
  );
}
