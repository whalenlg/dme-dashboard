import { useEffect, useMemo, useRef, useState } from 'react';

// LOAD LOG's list of the regression runs' .dash.logs, from the bridge
// (GET <bridge>/logs: each ROM pair's folder's v_dash_logs and dash_logs,
// $DMEKLR_TMP/dme_klr/<rom>/..., and the folders from before those
// (rom null), newest first). A click opens one with onOpen(url, name, label). With no bridge
// running it says so, and BROWSE… / drag-and-drop still work.
// Logs a release carries (release_logs.py fetch: release_v_dash_logs and
// release_dash_logs, each with release: <tag>) are listed too, and GET
// RELEASE LOGS fetches this version's through the bridge
// (GET /release-logs, POST /release-logs/fetch; ReleaseLogs below).
const C = { border:'#0d2e0d', textDim:'#ccddcc', textBright:'#00ff80', text:'#00e060', faint:'#7a8a7a' };

// Which simulator wrote each folder (v_run_dashboard_tests.sh: Verilator,
// run_dashboard_tests.sh: iverilog)
const SIM = { v_dash_logs: { name:'Verilator', color:'#44aaff' }, dash_logs: { name:'iverilog', color:'#ffaa44' } };
// release_<dir>: a release's runs (release_logs.py), by the same simulator
const baseDir = dir => String(dir).replace(/^release_/, '');
const isRelease = l => String(l.dir).startsWith('release_');
const simOf = dir => SIM[baseDir(dir)] ?? { name: dir, color: C.faint };
// The ROM pair's folder a log is in (89, 86, carpokes or a DME image's name), or
// "older" for the folders from before those
const romOf = l => l.rom ?? 'older';
const pathOf = l => `${l.rom != null ? `${l.rom}/` : ''}${l.dir}/${l.name}`;

// The list's columns: heading, sort value, width (flex: 1 for the name)
const COLS = [
  { key:'name',  label:'Test',      width:null,   align:'left'  },
  { key:'sim',   label:'Simulator', width:'72px', align:'left'  },
  { key:'rom',   label:'ROM',       width:'92px', align:'left'  },
  { key:'mtime', label:'Modified',  width:'108px', align:'left' },
  { key:'size',  label:'Size',      width:'52px', align:'right' },
];
const SORT_VAL = {
  name:  l => l.name.replace(/\.dash\.log$/, '').toLowerCase(),
  sim:   l => simOf(l.dir).name.toLowerCase(),
  rom:   l => romOf(l).toLowerCase(),
  mtime: l => l.mtime,
  size:  l => l.size,
};
const colStyle = c => c.width ? { width:c.width, flexShrink:0, textAlign:c.align } : { flex:1, minWidth:0, textAlign:c.align };

const fmtSize = n => n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`;
const fmtBig = n => n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`;
const fmtDate = ms => {
  const d = new Date(ms), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function LogList({ bridge, onOpen }) {
  const [logs, setLogs] = useState(null);   // null: loading; false: no bridge
  const [filter, setFilter] = useState('');
  // Include Verilator / iverilog logs: both checked each time LOAD LOG opens
  const [include, setInclude] = useState({ v_dash_logs: true, dash_logs: true, release: true });
  const toggle = dir => setInclude(i => ({ ...i, [dir]: !i[dir] }));
  // Sort: click a column heading; again to reverse. Newest first to start.
  const [sort, setSort] = useState({ key: 'mtime', dir: -1 });
  const sortBy = key => setSort(s => s.key === key ? { key, dir: -s.dir }
                                                   : { key, dir: key === 'mtime' || key === 'size' ? -1 : 1 });

  const [reload, setReload] = useState(0);   // again after GET RELEASE LOGS
  useEffect(() => {
    let live = true;
    fetch(`${bridge}/logs`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(l => { if (live) setLogs(Array.isArray(l) ? l : false); })
      .catch(() => { if (live) setLogs(false); });
    return () => { live = false; };
  }, [bridge, reload]);
  const hasRelease = !!logs && logs.some(isRelease);

  const shown = useMemo(() => {
    if (!logs) return [];
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
    const val = SORT_VAL[sort.key];
    return logs.filter(l => include[baseDir(l.dir)] !== false && (!isRelease(l) || include.release)
                            && words.every(w => `${pathOf(l)} ${simOf(l.dir).name} ${romOf(l)}${isRelease(l) ? ` release ${l.release ?? ''}` : ''}`.toLowerCase().includes(w)))
      .sort((a, b) => {
        const x = val(a), y = val(b);
        const c = typeof x === 'string' ? x.localeCompare(y, undefined, { numeric: true }) : x - y;
        return sort.dir * c || b.mtime - a.mtime;
      });
  }, [logs, filter, include, sort]);

  const note = { color:C.faint, fontSize:'10px', margin:'0 0 12px' };
  if (logs === null) return <div style={note}>Looking for regression logs on the bridge…</div>;
  if (logs === false) return (
    <div style={note}>
      Start the bridge (<code>dme_klr/live/bridge.mjs</code>) to list the regression logs here:
      Verilator runs (<code>v_dash_logs</code>) and iverilog runs (<code>dash_logs</code>) in each ROM pair's folder.
    </div>
  );
  const release = <ReleaseLogs bridge={bridge} onFetched={() => setReload(n => n + 1)} />;
  if (!logs.length) return (
    <div style={{marginBottom:'12px'}}>
      <div style={note}>No .dash.log files in <code>v_dash_logs</code> or <code>dash_logs</code> yet.</div>
      {release}
    </div>
  );

  const open = l => onOpen(`${bridge}/logs/${l.rom != null ? `${encodeURIComponent(l.rom)}/` : ''}${l.dir}/${encodeURIComponent(l.name)}`,
                           l.name, `${pathOf(l)} (${simOf(l.dir).name}${isRelease(l) ? `, release ${l.release ?? ''}` : ''})`);
  return (
    <div style={{marginBottom:'12px'}}>
      <div style={{display:'flex',alignItems:'center',flexWrap:'wrap',gap:'6px 8px',marginBottom:'5px'}}>
        <span style={{color:C.textDim,fontSize:'10px',flexShrink:0}}>Regression logs ({logs.length}):</span>
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="filter"
          aria-label="Filter the regression logs"
          style={{flex:1,minWidth:'160px',background:'#030803',border:`1px solid ${C.border}`,color:C.text,
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
        {hasRelease && (
          <label title="Show the logs fetched from a release (GET RELEASE LOGS)"
            style={{display:'flex',alignItems:'center',gap:'4px',flexShrink:0,cursor:'pointer',
                    color:C.textDim,fontSize:'10px',whiteSpace:'nowrap'}}>
            <input type="checkbox" checked={include.release} onChange={() => toggle('release')}
              style={{margin:0,cursor:'pointer'}} />
            Include release logs
          </label>
        )}
      </div>
      <div style={{maxHeight:'150px',overflowY:'auto',border:`1px solid ${C.border}`,background:'#030803'}}>
        <div style={{display:'flex',gap:'10px',padding:'3px 8px',fontSize:'10px',lineHeight:'14px',
                     position:'sticky',top:0,background:'#0a1a0a',borderBottom:`1px solid ${C.border}`}}>
          {COLS.map(c => (
            <span key={c.key} role="button" tabIndex={0} aria-sort={sort.key === c.key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}
              title={`Sort by ${c.label.toLowerCase()}`}
              onClick={() => sortBy(c.key)} onKeyDown={e => { if (e.key === 'Enter') sortBy(c.key); }}
              style={{...colStyle(c),cursor:'pointer',userSelect:'none',letterSpacing:'0.08em',
                      color:sort.key === c.key ? C.textBright : C.textDim}}>
              {c.label}{sort.key === c.key ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}
            </span>
          ))}
        </div>
        {shown.map(l => (
          <div key={pathOf(l)} role="button" tabIndex={0} title={`Open ${pathOf(l)} (${simOf(l.dir).name} run)`}
            onClick={() => open(l)} onKeyDown={e => { if (e.key === 'Enter') open(l); }}
            style={{display:'flex',gap:'10px',padding:'3px 8px',cursor:'pointer',fontSize:'11px',lineHeight:'16px',
                    borderBottom:`1px solid ${C.border}`}}
            onMouseEnter={e => { e.currentTarget.style.background = '#0d2e0d'; }}
            onMouseLeave={e => { e.currentTarget.style.background = ''; }}>
            <span style={{color:C.textBright,...colStyle(COLS[0]),overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
              {l.name.replace(/\.dash\.log$/, '')}
              {isRelease(l) && <span style={{color:C.faint,marginLeft:'6px'}} title={`From release ${l.release ?? '?'} (release_logs.py)`}>
                release {l.release ?? ''}</span>}
            </span>
            <span style={{color:simOf(l.dir).color,...colStyle(COLS[1])}}>{simOf(l.dir).name}</span>
            <span style={{color:l.rom != null ? C.textDim : C.faint,...colStyle(COLS[2]),overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}
              title={l.rom != null ? `tmp/dme_klr/${l.rom}` : 'tmp/dme_klr (from before the per-ROM folders)'}>{romOf(l)}</span>
            <span style={{color:C.faint,...colStyle(COLS[3])}}>{fmtDate(l.mtime)}</span>
            <span style={{color:C.faint,...colStyle(COLS[4])}}>{fmtSize(l.size)}</span>
          </div>
        ))}
        {!shown.length && <div style={{color:C.faint,fontSize:'10px',padding:'4px 8px'}}>{
          !Object.keys(SIM).some(d => include[d] !== false) ? 'Both kinds of log are unchecked.'
          : filter ? `No log matches “${filter}”.` : 'No logs of the checked kind.'}</div>}
      </div>
      {release}
    </div>
  );
}

// GET RELEASE LOGS: the regression logs this version's GitHub release
// carries (not the FSTs: release_logs.py fetch --fst does those), fetched
// by the bridge into release_v_dash_logs / release_dash_logs. Hidden with
// a bridge from before /release-logs.
function ReleaseLogs({ bridge, onFetched }) {
  const [info, setInfo] = useState(null);   // null: asking; false: no endpoint
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [poll, setPoll] = useState(0);      // ask again: a fetch was started

  // The parent's callback, without re-asking the bridge each time it renders
  const fetchedRef = useRef(onFetched);
  useEffect(() => { fetchedRef.current = onFetched; }, [onFetched]);
  const wasRunning = useRef(false);

  useEffect(() => {
    let live = true, timer = null;
    const ask = () => fetch(`${bridge}/release-logs`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(i => {
        if (!live) return;
        setInfo(i);
        const running = !!i.job?.running;
        if (wasRunning.current && !running) {
          fetchedRef.current();
          if (i.job && !i.job.ok) setErr(i.job.error || 'the fetch failed');
        }
        wasRunning.current = running;
        setBusy(running);
        if (running) timer = setTimeout(ask, 1000);
      })
      .catch(() => { if (live) setInfo(false); });
    ask();
    return () => { live = false; clearTimeout(timer); };
  }, [bridge, poll]);

  if (!info) return null;
  const roms = Object.entries(info.roms ?? {});
  const line = { display:'flex', alignItems:'center', gap:'8px', marginTop:'6px', fontSize:'10px', color:C.faint };
  if (!info.version || !roms.length) return (
    <div style={line} title={info.error ?? ''}>Release logs: none for this version{info.install_version ? ` (${info.install_version})` : ''}.</div>
  );
  const bytes = roms.reduce((n, [, r]) => n + (r.logs_bytes ?? 0), 0);
  const fst = roms.reduce((n, [, r]) => n + (r.fst_bytes ?? 0), 0);
  const have = roms.filter(([rom]) => info.fetched?.[rom]?.version === info.version && info.fetched[rom].logs).length;
  const job = info.job;
  const start = () => {
    setErr(null);
    fetch(`${bridge}/release-logs/fetch`, { method: 'POST' })
      .then(r => r.ok ? (wasRunning.current = true, setBusy(true), setPoll(n => n + 1)) : r.text().then(t => setErr(t || `HTTP ${r.status}`)))
      .catch(e => setErr(e.message));
  };
  const btn = { background:'#0a1a0a', border:`1px solid ${C.border}`, color:C.textBright, fontFamily:'inherit',
                fontSize:'10px', letterSpacing:'0.08em', padding:'3px 8px', cursor: busy ? 'default' : 'pointer', flexShrink:0 };
  return (
    <div style={line}>
      <span style={{color:C.textDim}}>Release {info.version}:</span>
      <span title={roms.map(([rom, r]) => `${rom}: ${fmtBig(r.logs_bytes)} of logs, ${fmtBig(r.fst_bytes)} of FSTs`).join('\n')}>
        regression logs for {roms.length} ROM pair{roms.length === 1 ? '' : 's'}, {fmtBig(bytes)}
        {have ? ` · fetched for ${have} of ${roms.length}` : ''}
      </span>
      <button style={btn} disabled={busy} onClick={start}
        title={`Download the logs (not the ${fmtBig(fst)} of FSTs: python3 dme_klr/release_logs.py fetch --fst) into release_v_dash_logs / release_dash_logs`}>
        {busy ? (job?.total ? `FETCHING ${Math.round(100 * job.done / job.total)}%` : 'FETCHING…') : have === roms.length ? 'GET AGAIN' : 'GET RELEASE LOGS'}
      </button>
      {busy && job?.asset && <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{job.asset}</span>}
      {err && <span style={{color:'#ff6060'}}>{err}</span>}
      {info.note && !busy && <span title={info.note} style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>({info.note})</span>}
    </div>
  );
}
