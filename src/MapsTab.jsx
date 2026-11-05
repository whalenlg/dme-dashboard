import { useState, useMemo, useEffect, memo } from "react";
import {
  ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { thin, inRange } from "./thin.js";
import { CursorLine } from "./cursor.jsx";
import { useZoom, zoomHandlers, ZoomBox, DragArea, ZoomBar } from "./zoom.jsx";
import { IRAM_MAP } from "./memDefs.js";
import { NUMBERED_MAPS, DIRECT_TABLES } from "./mapDefs.js";

// ─────────────────────────────────────────────────────────────────
//  MAPS TAB
//  One chart per DME map / table: the result of each lookup over time.
//  The disassembly's Numbered Maps (map_lookup, 0x051D, map number in R2)
//  and Directly Addressed Tables (linear_lookup and the MOVC reads of the
//  AFM and transient fuel tables). Reads the testbench's lookup lines:
//    DME: [LKUP] <ms>,M<map>,<result>,<xa>=<xv>[,<ya>=<yv>]
//    DME: [LKUP] <ms>,T<addr>,<result>,<xa>=<xv> | in=<index>
//  A map is logged when its result changes, and otherwise once per
//  DS interval while the firmware keeps looking it up, so each line is
//  drawn as a step: the value holds until the next point.
//  Clicking a chart's title shows the graph of that map or table as it is
//  in the DME image the simulator bridge has loaded (map_graphs.py, served
//  at <bridge>/maps/dme; drawn once per image contents).
// ─────────────────────────────────────────────────────────────────

const C = {
  panelBg:'#060e06', panelBg2:'#0a150a', border:'#0d2e0d',
  textDim:'#ccddcc', textBright:'#00ff80', blue:'#44aaff', amber:'#ffaa00',
};
const MAX_POINTS = 400;   // per chart, after thinning
const hx = v => v.toString(16).toUpperCase().padStart(2, '0');
const iramName = a => {
  const n = IRAM_MAP.find(e => e.a === a)?.n ?? '';
  return /^r[0-9A-F]{2}$/.test(n) ? '' : n;
};
const inLabel = k => k === 'in' ? 'index' : `${hx(k)}h${iramName(k) ? ` ${iramName(k)}` : ''}`;

// Every chart the tab can show, in workbook order, then anything else the
// log has (maps and tables that aren't on the two sheets)
function allDefs(lookups) {
  const defs = [
    ...NUMBERED_MAPS.map(m => ({ id: `M${m.n}`, kind: 'map', title: `MAP ${m.n}`, name: m.name,
      purpose: m.purpose, detail: `R2=${m.r2} · ${m.addr} · axes ${m.axes}`, covered: m.covered })),
    ...DIRECT_TABLES.map(t => ({ id: `T${t.addr}`, kind: 'table', title: `${t.addr}h`, name: t.name,
      purpose: t.purpose, detail: `table at ${t.addr}h`, covered: t.covered })),
  ];
  const known = new Set(defs.map(d => d.id));
  const extra = Object.keys(lookups ?? {}).filter(id => !known.has(id)).sort((a, b) =>
    a[0] !== b[0] ? (a[0] === 'M' ? -1 : 1) : parseInt(a.slice(1), a[0] === 'M' ? 10 : 16) - parseInt(b.slice(1), a[0] === 'M' ? 10 : 16));
  for (const id of extra) defs.push(id[0] === 'M'
    ? { id, kind: 'other', title: `MAP ${id.slice(1)}`, name: '(not on the Numbered Maps sheet)', purpose: '',
        detail: `R2=${hx(+id.slice(1))}h` }
    : { id, kind: 'other', title: `${id.slice(1)}h`, name: '(not on the Directly Addressed Tables sheet)', purpose: '',
        detail: `table at ${id.slice(1)}h` });
  return defs;
}

function TipBox({ active, payload, label }) {
  if (!active || label == null || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div style={{background:'#060e06ee',border:`1px solid ${C.border}`,padding:'4px 7px',fontSize:'10px',lineHeight:1.35}}>
      <div style={{color:C.textBright}}>t={(+label).toFixed(3)} ms</div>
      <div style={{color:C.amber}}>result: 0x{hx(p.v)} ({p.v})</div>
      {(p.in ?? []).map(([k, v]) => (
        <div key={k} style={{color:C.textDim}}>{inLabel(k)}: 0x{hx(v)} ({v})</div>
      ))}
    </div>
  );
}

// One map's chart; memoized so a live tick only redraws charts whose data moved
const MapChart = memo(function MapChart({ def, pts, n, t0, t1, zoom, onOpen }) {
  const ax = {fill:C.textDim,fontSize:9,fontFamily:"'Share Tech Mono',monospace"};
  const last = pts[pts.length - 1];
  let lo = 255, hi = 0;
  for (const p of pts) { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; }
  const inputs = last?.in?.map(([k]) => inLabel(k)).join(', ');
  return (
    <div style={{background:C.panelBg,border:`1px solid ${C.border}`,borderRadius:'2px',padding:'6px 8px',minWidth:0,textAlign:'left'}}>
      <div style={{display:'flex',gap:'8px',alignItems:'baseline',flexWrap:'wrap'}}>
        <span onClick={() => onOpen(def)} title="show this map's graph from the loaded ROM"
              style={{display:'flex',gap:'8px',alignItems:'baseline',cursor:'pointer',textDecoration:'underline dotted',textUnderlineOffset:'3px'}}>
          <span style={{color:C.textBright,fontSize:'11px',letterSpacing:'0.1em'}}>{def.title}</span>
          <span style={{color:C.blue,fontSize:'10px'}}>{def.name}</span>
        </span>
        <span style={{marginLeft:'auto',color:C.amber,fontSize:'10px'}}>
          {last ? `0x${hx(last.v)} (${last.v})` : ''}
        </span>
      </div>
      <div style={{color:C.textDim,fontSize:'9px',opacity:0.8,minHeight:'12px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}
           title={[def.purpose, def.detail, def.covered && `covered in: ${def.covered}`].filter(Boolean).join('\n')}>
        {def.purpose}{def.purpose ? ' · ' : ''}{def.detail}
      </div>
      {pts.length === 0
        ? <div style={{height:n ? 110 : 36,display:'flex',alignItems:'center',justifyContent:'center',color:'#557755',fontSize:'10px'}}>
            {n ? 'no lookups in the zoomed range' : 'not looked up in this log'}
          </div>
        : <ZoomBox zoom={zoom}><ResponsiveContainer width="100%" height={110}>
            <ComposedChart data={pts} margin={{top:4,right:6,bottom:0,left:0}} {...zoomHandlers(zoom)}>
              <CartesianGrid strokeDasharray="2 4" stroke="#0d2e0d" />
              <XAxis dataKey="t" type="number" domain={[t0, t1]} allowDataOverflow tick={ax}
                     tickFormatter={v => `${+v.toFixed(0)}`} stroke={C.textDim} />
              <YAxis tick={ax} stroke={C.textDim} width={34} allowDecimals={false}
                     domain={[0, hi > 0 ? 'dataMax' : 1]} />
              <Tooltip content={<TipBox />} isAnimationActive={false} />
              <CursorLine stroke={C.textBright} strokeWidth={1} />
              <DragArea zoom={zoom} fill={C.textBright} />
              <Line dataKey="v" type="stepAfter" stroke={C.amber} strokeWidth={1.3} isAnimationActive={false}
                    dot={pts.length <= 40 ? {r:1.5, fill:C.amber, stroke:'none'} : false} />
            </ComposedChart>
          </ResponsiveContainer></ZoomBox>}
      <div style={{display:'flex',gap:'10px',color:C.textDim,fontSize:'8px',opacity:0.75}}>
        <span>{n} logged</span>
        {pts.length > 0 && <span>range 0x{hx(lo)}–0x{hx(hi)}</span>}
        {inputs && <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>in: {inputs}</span>}
      </div>
    </div>
  );
});

// The graph of one map or table, from the bridge's map_graphs.py output for
// the DME image the sim has loaded. Polls while the bridge is drawing.
function RomGraph({ def, bridge, onClose }) {
  const [info, setInfo] = useState(null);     // { status, sha, rom, error, maps, tables } or { unreachable }
  const [img, setImg] = useState(null);       // object URL
  const [imgErr, setImgErr] = useState(null);

  useEffect(() => {
    let stop = false, timer = null;
    const poll = () => fetch(`${bridge}/maps/dme`).then(r => r.json())
      .then(j => { if (stop) return; setInfo(j); if (j.status === 'generating' || j.status === 'none') timer = setTimeout(poll, 2000); })
      .catch(() => { if (!stop) setInfo({ unreachable: true }); });
    poll();
    return () => { stop = true; clearTimeout(timer); };
  }, [bridge]);

  const entry = info?.status === 'ready'
    ? (def.id[0] === 'M' ? info.maps?.[def.id.slice(1)] : info.tables?.[def.id.slice(1).padStart(4, '0')])
    : null;
  const file = entry?.file;
  useEffect(() => {
    if (!file || !info?.sha) return;
    let url = null, stop = false;
    fetch(`${bridge}/maps/dme/${info.sha}/${file}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); })
      .then(b => { if (stop) return; url = URL.createObjectURL(b); setImg(url); })
      .catch(e => { if (!stop) setImgErr(e.message); });
    return () => { stop = true; if (url) URL.revokeObjectURL(url); };
  }, [bridge, info?.sha, file]);

  useEffect(() => {
    const k = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const note = s => <div style={{color:C.textDim,fontSize:'12px',padding:'40px 20px',textAlign:'center',lineHeight:1.6}}>{s}</div>;
  let body;
  if (!info) body = note('asking the simulator bridge…');
  else if (info.unreachable) body = note(<>Can't reach the simulator bridge at {bridge}.<br />
    The graphs are drawn on your machine from the loaded ROM: start it with
    <code style={{color:C.blue}}> node dme_klr/live/bridge.mjs</code> (needs python3 with matplotlib).</>);
  else if (info.status === 'none') body = note('The bridge has no DME image loaded yet. Waiting for the simulator…');
  else if (info.status === 'generating') body = note(`Drawing the graphs for ${info.rom} (once per ROM image, about 20 s)…`);
  else if (info.status === 'error') body = note(<>map_graphs.py failed for {info.rom}:<br />
    <pre style={{color:C.amber,textAlign:'left',whiteSpace:'pre-wrap',fontSize:'10px'}}>{info.error}</pre></>);
  else if (!file) body = note(`${info.rom} has no ${def.id[0] === 'M' ? `map ${def.id.slice(1)}` : `table ${def.id.slice(1)}h`} (the map index entry is FFh).`);
  else if (imgErr) body = note(`Couldn't load the graph: ${imgErr}`);
  else if (!img) body = note('loading…');
  else body = <img src={img} alt={`${def.title} graph`} style={{maxWidth:'100%',maxHeight:'calc(100vh - 140px)',display:'block',margin:'0 auto',background:'#fff'}} />;

  return (
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'#000c',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:'16px'}}>
      <div onClick={e => e.stopPropagation()}
           style={{background:C.panelBg,border:`1px solid ${C.border}`,padding:'10px 12px',maxWidth:'min(1650px, 100%)',width:'100%',textAlign:'left'}}>
        <div style={{display:'flex',gap:'10px',alignItems:'baseline',marginBottom:'8px',flexWrap:'wrap'}}>
          <span style={{color:C.textBright,fontSize:'13px',letterSpacing:'0.1em'}}>{def.title}</span>
          <span style={{color:C.blue,fontSize:'12px'}}>{def.name}</span>
          {info?.rom && <span style={{color:C.textDim,fontSize:'10px'}}>
            ROM {info.rom}{info.sha ? ` · ${info.sha}` : ''}{entry ? ` · ${entry.addr ? `${entry.addr}h · ` : ''}${entry.bytes} bytes` : ''}</span>}
          <button onClick={onClose} style={{marginLeft:'auto',background:C.panelBg2,border:`1px solid ${C.border}`,color:C.textDim,
                                            fontFamily:'inherit',fontSize:'11px',cursor:'pointer',padding:'2px 10px'}}>CLOSE ✕</button>
        </div>
        {body}
      </div>
    </div>
  );
}

// lookups: id -> [{ t, v, in }] (dmeLogParser); ver bumps when any grows
// bridge: the simulator bridge's URL, where the ROM graphs come from
const MapsTab = memo(function MapsTab({ lookups, ver, onSeek, range, setRange, bridge }) {
  const [open, setOpen] = useState(null);   // def whose ROM graph is shown
  const [filter, setFilter] = useState('');
  const [showMaps, setShowMaps] = useState(true);
  const [showTables, setShowTables] = useState(true);
  const [showOther, setShowOther] = useState(false);
  const [usedOnly, setUsedOnly] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const defs = useMemo(() => allDefs(lookups), [lookups, ver]);
  const full = useMemo(() => {
    let a = Infinity, b = -Infinity;
    for (const arr of Object.values(lookups ?? {})) if (arr.length) {
      if (arr[0].t < a) a = arr[0].t;
      if (arr[arr.length - 1].t > b) b = arr[arr.length - 1].t;
    }
    return a <= b ? [a, b] : [0, 0];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookups, ver]);
  const [t0, t1] = range ?? full;
  const zoom = useZoom(range, setRange, full, onSeek);

  // Points per chart in the zoom range, thinned
  const series = useMemo(() => {
    const out = {};
    for (const d of defs) {
      const arr = lookups?.[d.id] ?? [];
      out[d.id] = { n: arr.length, pts: thin(inRange(arr, [t0, t1]), ['v'], MAX_POINTS) };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defs, lookups, ver, t0, t1]);

  const nLines = Object.values(lookups ?? {}).reduce((s, a) => s + a.length, 0);
  if (!nLines) return (
    <div style={{textAlign:'center',color:C.textDim,padding:'60px',fontSize:'13px',lineHeight:1.6}}>
      No map lookups in this log.<br />
      <span style={{fontSize:'11px'}}>
        The lookup results come from <code style={{color:C.blue}}>DME: [LKUP]</code> lines, which
        dme_klr_dashboard_tb.v prints from the version that added this tab on. Re-run the test with
        run_dashboard_tests.sh, or press LIVE.
      </span>
    </div>
  );

  const q = filter.trim().toLowerCase();
  const match = d => !q || [d.title, d.name, d.purpose, d.detail, d.covered, d.id].some(s => s?.toLowerCase().includes(q));
  const visible = kind => defs.filter(d => d.kind === kind && match(d) && (!usedOnly || series[d.id].n > 0));

  const panel = {background:C.panelBg,border:`1px solid ${C.border}`,borderRadius:'2px',padding:'8px 10px',marginBottom:'8px'};
  const btn = {padding:'3px 10px',background:C.panelBg2,border:`1px solid ${C.border}`,color:C.textDim,
               fontFamily:'inherit',fontSize:'10px',cursor:'pointer'};
  const inp = {background:'#030803',border:`1px solid ${C.border}`,color:C.textBright,fontFamily:'inherit',
               fontSize:'10px',padding:'3px 5px'};
  const check = (v, set, label, col = C.textDim) => (
    <label style={{color:col,fontSize:'10px',cursor:'pointer'}}>
      <input type="checkbox" checked={v} onChange={e => set(e.target.checked)} /> {label}
    </label>
  );
  const section = (kind, heading, note) => {
    const list = visible(kind);
    const used = defs.filter(d => d.kind === kind && series[d.id].n > 0).length;
    return (
      <div style={{marginBottom:'12px'}}>
        <div style={{color:C.textDim,fontSize:'9px',letterSpacing:'0.2em',margin:'4px 0 6px'}}>
          {heading} <span style={{letterSpacing:0,opacity:0.7}}>· {used} of {defs.filter(d => d.kind === kind).length} looked up · {note}</span>
        </div>
        {list.length === 0
          ? <div style={{color:'#557755',fontSize:'10px',padding:'4px'}}>none match</div>
          : <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(380px, 1fr))',gap:'8px'}}>
              {list.map(d => <MapChart key={d.id} def={d} pts={series[d.id].pts} n={series[d.id].n}
                                       t0={t0} t1={t1} zoom={zoom} onOpen={setOpen} />)}
            </div>}
      </div>
    );
  };

  return (
    <div style={{userSelect:'none',textAlign:'left'}}>
      {open && <RomGraph def={open} bridge={bridge} onClose={() => setOpen(null)} />}
      <div style={{...panel,display:'flex',gap:'14px',alignItems:'center',flexWrap:'wrap'}}>
        <ZoomBar zoom={zoom} range={range} full={full} btn={btn} color={C.textBright} dim={C.textDim} hint={false} />
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="filter: number, name, purpose"
               style={{...inp,width:'200px'}} />
        {check(showMaps, setShowMaps, 'NUMBERED MAPS')}
        {check(showTables, setShowTables, 'DIRECT TABLES')}
        {check(showOther, setShowOther, 'OTHERS IN LOG')}
        {check(usedOnly, setUsedOnly, 'LOOKED UP ONLY')}
        <span style={{color:C.textDim,fontSize:'9px',marginLeft:'auto'}}>
          click a title for the ROM's graph · drag to zoom · ctrl+wheel zoom · shift+wheel pan · double-click reset · click to move scrubber · hover for the inputs
        </span>
      </div>
      {showMaps && section('map', 'NUMBERED MAPS', 'map_lookup result (A on return), axes from the map header')}
      {showTables && section('table', 'DIRECTLY ADDRESSED TABLES', 'byte read from the table; 1140h/1150h share one read (1150h = index 10h and up)')}
      {showOther && section('other', 'OTHER MAPS AND TABLES IN THIS LOG', 'looked up by the firmware but not on either sheet')}
    </div>
  );
});

export default MapsTab;
