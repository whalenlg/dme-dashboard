import { useState, useMemo, useEffect, memo } from "react";
import {
  ComposedChart, Line, Scatter, Cell, XAxis, ZAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
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
//  byRpm (DME RPM MAPS tab): only the maps with rpm (37h) as an input, each
//  lookup drawn as a point against engine speed (37h x 40 rpm) instead of
//  time; for a 3D map the point's colour is the other input (blue low,
//  amber high). The zoom is an rpm range.
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

// A map's input iram addresses, from the workbook's Axes column ("37h, 49h")
const parseAxes = s => (s ?? '').split(',').map(a => parseInt(a, 16)).filter(a => !Number.isNaN(a));
const RPM = 0x37;
const RPM_SCALE = 40;          // 37h counts 40 rpm
const MAX_RPM_POINTS = 1500;   // per chart: distinct (rpm, inputs, result) points
const hasRpm = (d, lookups) => d.id[0] === 'M' && (d.axes?.includes(RPM) ||
  (lookups?.[d.id]?.at(-1)?.in ?? []).some(([k]) => k === RPM));

// The distinct lookups of one map as points against rpm, sorted by rpm:
// { r: rpm, v: result, z: the other input (3D) or null, in, t: first time seen }
function rpmPoints(arr) {
  const seen = new Map();
  for (const p of arr) {
    const ri = p.in?.find(([k]) => k === RPM);
    if (!ri) continue;
    const key = `${p.v}|${(p.in ?? []).map(([k, v]) => `${k}:${v}`).join(',')}`;
    if (seen.has(key)) continue;
    const oz = p.in.find(([k]) => k !== RPM && k !== 'in');
    seen.set(key, { r: ri[1] * RPM_SCALE, v: p.v, z: oz ? oz[1] : null, in: p.in, t: p.t });
  }
  let pts = [...seen.values()].sort((a, b) => a.r - b.r || a.z - b.z);
  if (pts.length > MAX_RPM_POINTS) {
    const step = pts.length / MAX_RPM_POINTS;
    pts = Array.from({ length: MAX_RPM_POINTS }, (_, i) => pts[Math.floor(i * step)]);
  }
  return pts;
}
// blue (low) -> amber (high)
const zColour = (z, lo, hi) => `hsl(${210 - 170 * (hi > lo ? (z - lo) / (hi - lo) : 0.5)}, 100%, 58%)`;

// Maps sorted: known 3D maps first, then known 2D maps, then the maps whose
// purpose is still unknown (same order among them). Within each group by
// input: rpm (37h) first, then the other inputs from most to least used,
// then by map number.
const isUnknown = d => /unknown/i.test(d.name ?? '') || /^unknown$/i.test(d.purpose ?? '') || d.kind === 'other';
function sortByInputs(maps) {
  const uses = new Map();
  for (const d of maps) for (const a of d.axes) uses.set(a, (uses.get(a) ?? 0) + 1);
  const rank = a => a === RPM ? -1e9 : -(uses.get(a) ?? 0) * 256 + a;   // ties: lower address first
  const key = d => d.axes.length ? d.axes.map(rank) : [Infinity];
  const group = d => (isUnknown(d) ? 2 : 0) + (d.dim === 3 ? 0 : 1);
  return [...maps].sort((x, y) => {
    if (group(x) !== group(y)) return group(x) - group(y);
    const kx = key(x), ky = key(y);
    for (let i = 0; i < Math.min(kx.length, ky.length); i++) if (kx[i] !== ky[i]) return kx[i] - ky[i];
    return kx.length - ky.length || +x.id.slice(1) - +y.id.slice(1);
  });
}

// Every chart the tab can show: the numbered maps sorted by input, the
// tables in workbook order, then anything else the log has (maps and tables
// that aren't on the two sheets)
function allDefs(lookups) {
  const maps = sortByInputs(NUMBERED_MAPS.map(m => {
    const axes = parseAxes(m.axes);
    return { id: `M${m.n}`, kind: 'map', title: `MAP ${m.n}`, name: m.name, axes, dim: axes.length > 1 ? 3 : 2,
      purpose: m.purpose, detail: `R2=${m.r2} · ${m.addr} · axes ${m.axes}`, covered: m.covered };
  }));
  const defs = [
    ...maps,
    ...DIRECT_TABLES.map(t => ({ id: `T${t.addr}`, kind: 'table', title: `${t.addr}h`, name: t.name,
      purpose: t.purpose, detail: `table at ${t.addr}h`, covered: t.covered })),
  ];
  const known = new Set(defs.map(d => d.id));
  const extra = Object.keys(lookups ?? {}).filter(id => !known.has(id)).sort((a, b) =>
    a[0] !== b[0] ? (a[0] === 'M' ? -1 : 1) : parseInt(a.slice(1), a[0] === 'M' ? 10 : 16) - parseInt(b.slice(1), a[0] === 'M' ? 10 : 16));
  const others = [];
  for (const id of extra) {
    if (id[0] === 'M') {
      // Inputs as the log shows them (the axis addresses of the last lookup)
      const arr = lookups[id];
      const axes = (arr[arr.length - 1]?.in ?? []).map(([k]) => k).filter(k => k !== 'in');
      others.push({ id, kind: 'other', title: `MAP ${id.slice(1)}`, name: '(not on the Numbered Maps sheet)', purpose: '',
        axes, dim: axes.length ? (axes.length > 1 ? 3 : 2) : null, detail: `R2=${hx(+id.slice(1))}h` });
    } else {
      others.push({ id, kind: 'other', title: `${id.slice(1)}h`, name: '(not on the Directly Addressed Tables sheet)', purpose: '',
        detail: `table at ${id.slice(1)}h` });
    }
  }
  const otherMaps = sortByInputs(others.filter(d => d.id[0] === 'M'));
  return [...defs, ...otherMaps, ...others.filter(d => d.id[0] !== 'M')];
}

function TipBox({ active, payload, label, xRpm }) {
  if (!active || !payload?.length || (!xRpm && label == null)) return null;
  const p = payload[0].payload;
  return (
    <div style={{background:'#060e06ee',border:`1px solid ${C.border}`,padding:'4px 7px',fontSize:'10px',lineHeight:1.35}}>
      <div style={{color:C.textBright}}>{xRpm ? `${p.r} rpm · first at t=${(+p.t).toFixed(3)} ms` : `t=${(+label).toFixed(3)} ms`}</div>
      <div style={{color:C.amber}}>result: 0x{hx(p.v)} ({p.v})</div>
      {(p.in ?? []).map(([k, v]) => (
        <div key={k} style={{color:C.textDim}}>{inLabel(k)}: 0x{hx(v)} ({v})</div>
      ))}
    </div>
  );
}

// One map's chart; memoized so a live tick only redraws charts whose data moved
const MapChart = memo(function MapChart({ def, pts, n, t0, t1, zoom, onOpen, xRpm }) {
  const ax = {fill:C.textDim,fontSize:9,fontFamily:"'Share Tech Mono',monospace"};
  const last = pts[pts.length - 1];
  let lo = 255, hi = 0;
  for (const p of pts) { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; }
  const inputs = last?.in?.map(([k]) => inLabel(k)).join(', ');
  let zlo = 255, zhi = 0;
  for (const p of pts) if (p.z != null) { if (p.z < zlo) zlo = p.z; if (p.z > zhi) zhi = p.z; }
  const zKey = xRpm && pts.find(p => p.z != null)?.in.find(([k]) => k !== RPM && k !== 'in')?.[0];
  return (
    <div style={{background:C.panelBg,border:`1px solid ${C.border}`,borderRadius:'2px',padding:'6px 8px',minWidth:0,textAlign:'left'}}>
      <div style={{display:'flex',gap:'8px',alignItems:'baseline',flexWrap:'wrap'}}>
        <span onClick={() => onOpen(def)} title="show this map's graph from the loaded ROM"
              style={{display:'flex',gap:'8px',alignItems:'baseline',cursor:'pointer',textDecoration:'underline dotted',textUnderlineOffset:'3px'}}>
          <span style={{color:C.textBright,fontSize:'11px',letterSpacing:'0.1em'}}>{def.title}</span>
          <span style={{color:C.blue,fontSize:'10px'}}>{def.name}</span>
        </span>
        {def.dim && <span title={def.dim === 3 ? 'two inputs: bilinear over a grid' : 'one input: linear between breakpoints'}
              style={{color:def.dim === 3 ? C.amber : C.textDim,border:`1px solid ${def.dim === 3 ? C.amber : C.border}`,
                      fontSize:'9px',padding:'0 4px',borderRadius:'2px',letterSpacing:'0.05em'}}>{def.dim}D MAP</span>}
        <span style={{marginLeft:'auto',color:C.amber,fontSize:'10px'}}>
          {last && !xRpm ? `0x${hx(last.v)} (${last.v})` : ''}
        </span>
      </div>
      <div style={{color:C.textDim,fontSize:'9px',opacity:0.8,minHeight:'12px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}
           title={[def.purpose, def.detail, def.covered && `covered in: ${def.covered}`].filter(Boolean).join('\n')}>
        {def.purpose}{def.purpose ? ' · ' : ''}{def.detail}
      </div>
      {pts.length === 0
        ? <div style={{height:n ? 110 : 36,display:'flex',alignItems:'center',justifyContent:'center',color:'#557755',fontSize:'10px'}}>
            {n ? `no lookups in the zoomed ${xRpm ? 'rpm' : 'time'} range` : 'not looked up in this log'}
          </div>
        : <ZoomBox zoom={zoom}><ResponsiveContainer width="100%" height={110}>
            <ComposedChart data={pts} margin={{top:4,right:6,bottom:0,left:0}} {...zoomHandlers(zoom)}>
              <CartesianGrid strokeDasharray="2 4" stroke="#0d2e0d" />
              <XAxis dataKey={xRpm ? 'r' : 't'} type="number" domain={[t0, t1]} allowDataOverflow tick={ax}
                     tickFormatter={v => `${+v.toFixed(0)}`} stroke={C.textDim} />
              <YAxis dataKey="v" type="number" tick={ax} stroke={C.textDim} width={34} allowDecimals={false}
                     domain={[0, hi > 0 ? 'dataMax' : 1]} />
              <Tooltip content={<TipBox xRpm={xRpm} />} isAnimationActive={false} />
              {xRpm && <ZAxis range={[14, 14]} />}
              {!xRpm && <CursorLine stroke={C.textBright} strokeWidth={1} />}
              <DragArea zoom={zoom} fill={C.textBright} />
              {xRpm
                ? <Scatter dataKey="v" isAnimationActive={false} shape="circle" fill={C.amber}
                           line={def.dim !== 3 ? {stroke:C.amber, strokeWidth:1} : false}>
                    {pts.map((p, i) => <Cell key={i} fill={p.z != null ? zColour(p.z, zlo, zhi) : C.amber} />)}
                  </Scatter>
                : <Line dataKey="v" type="stepAfter" stroke={C.amber} strokeWidth={1.3} isAnimationActive={false}
                        dot={pts.length <= 40 ? {r:1.5, fill:C.amber, stroke:'none'} : false} />}
            </ComposedChart>
          </ResponsiveContainer></ZoomBox>}
      <div style={{display:'flex',gap:'2px 10px',flexWrap:xRpm ? 'wrap' : 'nowrap',whiteSpace:'nowrap',color:C.textDim,fontSize:'8px',opacity:0.75}}>
        <span>{n} logged{xRpm ? ` · ${pts.length} distinct shown` : ''}</span>
        {zKey != null && <span title="colour of each point: the map's other input">
          colour: {inLabel(zKey)} <span style={{color:zColour(zlo, zlo, zhi)}}>0x{hx(zlo)}</span>→<span style={{color:zColour(zhi, zlo, zhi)}}>0x{hx(zhi)}</span>
        </span>}
        {pts.length > 0 && <span>range 0x{hx(lo)}–0x{hx(hi)}</span>}
        {inputs && <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>in: {inputs}</span>}
      </div>
    </div>
  );
});

// The graph of one map or table, from the bridge's map_graphs.py output.
// logRom: the DME image a loaded log names ({ file, sha }, from its
// DME: [ROM] line): its graphs are asked for by hash. false: a log that
// doesn't name one; null: live, where the sim's loaded image is the one.
// Either way without a hash the bridge's loaded image is drawn.
// Polls while the bridge is drawing.
function RomGraph({ def, bridge, logRom, onClose }) {
  const [info, setInfo] = useState(null);     // { status, sha, rom, error, maps, tables } or { unreachable }
  const [img, setImg] = useState(null);       // object URL
  const [imgErr, setImgErr] = useState(null);

  useEffect(() => {
    let stop = false, timer = null;
    const q = /^[0-9a-f]{16}$/.test(logRom?.sha ?? '') ? `?sha=${logRom.sha}` : '';
    const poll = () => fetch(`${bridge}/maps/dme${q}`).then(r => r.json())
      .then(j => { if (stop) return; setInfo(j); if (j.status === 'generating' || j.status === 'none') timer = setTimeout(poll, 2000); })
      .catch(() => { if (!stop) setInfo({ unreachable: true }); });
    poll();
    return () => { stop = true; clearTimeout(timer); };
  }, [bridge, logRom?.sha]);

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
  else if (info.status === 'unknown') body = note(<>This log ran on {logRom?.file} (sha {info.sha}), and the bridge
    has no image with that content: it isn't in bin_images/dme or among the uploaded ROMs on this machine.<br />
    Copy the image into bin_images/dme, or load it with LIVE → LOAD .mem, and open the graph again.</>);
  else if (info.status === 'none') body = note('The bridge has no DME image loaded yet. Waiting for the simulator…');
  else if (info.status === 'generating') body = note(`Drawing the graphs for ${info.rom} (once per ROM image, about 20 s)…`);
  else if (info.status === 'error') body = note(<>map_graphs.py failed for {info.rom}:<br />
    <pre style={{color:C.amber,textAlign:'left',whiteSpace:'pre-wrap',fontSize:'10px'}}>{info.error}</pre></>);
  else if (!file) body = note(`${info.rom} has no ${def.id[0] === 'M' ? `map ${def.id.slice(1)}` : `table ${def.id.slice(1)}h`} (the map index entry is FFh).`);
  else if (imgErr) body = note(`Couldn't load the graph: ${imgErr}`);
  else if (!img) body = note('loading…');
  else body = <img src={img} alt={`${def.title} graph`} style={{maxWidth:'100%',maxHeight:'calc(100vh - 140px)',display:'block',margin:'0 auto',background:'#fff'}} />;

  // Graphs that may not be the log's ROM: say so above them
  const caution = info?.status === 'ready' && logRom !== null && !(logRom?.sha && logRom.sha === info.sha)
    ? (logRom === false
        ? "This log doesn't say which ROM it ran on (it's from before the run scripts recorded it), so this is the bridge's loaded ROM."
        : `The log's ROM ${logRom.file} couldn't be identified when it ran (sha=${logRom.sha}), so this is the bridge's loaded ROM.`)
    : null;

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
        {caution && <div style={{color:C.amber,fontSize:'10px',margin:'-2px 0 6px'}}>⚠ {caution}</div>}
        {body}
      </div>
    </div>
  );
}

// lookups: id -> [{ t, v, in }] (dmeLogParser); ver bumps when any grows
// bridge: the simulator bridge's URL, where the ROM graphs come from
const MapsTab = memo(function MapsTab({ lookups, ver, onSeek, range, setRange, bridge, logRom, byRpm = false }) {
  const [open, setOpen] = useState(null);   // def whose ROM graph is shown
  const [filter, setFilter] = useState('');
  const [showMaps, setShowMaps] = useState(true);
  const [showTables, setShowTables] = useState(true);
  const [showOther, setShowOther] = useState(false);
  const [usedOnly, setUsedOnly] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const defs = useMemo(() => byRpm ? allDefs(lookups).filter(d => hasRpm(d, lookups)) : allDefs(lookups), [lookups, ver, byRpm]);
  // byRpm: each map's distinct lookups against rpm
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rpmPts = useMemo(() => byRpm ? Object.fromEntries(defs.map(d => [d.id, rpmPoints(lookups?.[d.id] ?? [])])) : null, [defs, lookups, ver, byRpm]);
  const full = useMemo(() => {
    let a = Infinity, b = -Infinity;
    if (rpmPts) {
      for (const pts of Object.values(rpmPts)) if (pts.length) {
        if (pts[0].r < a) a = pts[0].r;
        if (pts[pts.length - 1].r > b) b = pts[pts.length - 1].r;
      }
      return a <= b ? [0, b] : [0, 0];
    }
    for (const arr of Object.values(lookups ?? {})) if (arr.length) {
      if (arr[0].t < a) a = arr[0].t;
      if (arr[arr.length - 1].t > b) b = arr[arr.length - 1].t;
    }
    return a <= b ? [a, b] : [0, 0];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookups, ver, rpmPts]);
  const [t0, t1] = range ?? full;
  const zoom = useZoom(range, setRange, full, byRpm ? undefined : onSeek);

  // Points per chart in the zoom range, thinned
  const series = useMemo(() => {
    const out = {};
    for (const d of defs) {
      const arr = lookups?.[d.id] ?? [];
      out[d.id] = rpmPts
        ? { n: arr.length, pts: rpmPts[d.id].filter(p => p.r >= t0 && p.r <= t1) }
        : { n: arr.length, pts: thin(inRange(arr, [t0, t1]), ['v'], MAX_POINTS) };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defs, lookups, ver, t0, t1, rpmPts]);

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
  const match = d => !q || [d.title, d.name, d.purpose, d.detail, d.covered, d.id, d.dim && `${d.dim}D`].some(s => s?.toLowerCase().includes(q));
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
                                       t0={t0} t1={t1} zoom={zoom} onOpen={setOpen} xRpm={byRpm} />)}
            </div>}
      </div>
    );
  };

  return (
    <div style={{userSelect:'none',textAlign:'left'}}>
      {open && <RomGraph def={open} bridge={bridge} logRom={logRom} onClose={() => setOpen(null)} />}
      <div style={{...panel,display:'flex',gap:'14px',alignItems:'center',flexWrap:'wrap'}}>
        <ZoomBar zoom={zoom} range={range} full={full} btn={btn} color={C.textBright} dim={C.textDim} hint={false} unit={byRpm ? 'rpm' : 'ms'} />
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="filter: number, name, purpose"
               style={{...inp,width:'200px'}} />
        {check(showMaps, setShowMaps, 'NUMBERED MAPS')}
        {!byRpm && check(showTables, setShowTables, 'DIRECT TABLES')}
        {check(showOther, setShowOther, 'OTHERS IN LOG')}
        {check(usedOnly, setUsedOnly, 'LOOKED UP ONLY')}
        <span style={{color:C.textDim,fontSize:'9px',marginLeft:'auto'}}>
          click a title for the ROM's graph · drag to zoom · ctrl+wheel zoom · shift+wheel pan · double-click reset · {byRpm ? 'x axis: rpm (37h × 40) · 3D maps coloured by their other input' : 'click to move scrubber'} · hover for the inputs
        </span>
      </div>
      {showMaps && section('map', byRpm ? 'NUMBERED MAPS WITH RPM AS AN INPUT' : 'NUMBERED MAPS', byRpm
        ? 'map_lookup result against rpm · each distinct lookup once · 3D maps, then 2D, then unknown ones'
        : 'map_lookup result (A on return) · 3D maps, then 2D, then unknown ones · each by input: rpm first, then the most used')}
      {showTables && !byRpm && section('table', 'DIRECTLY ADDRESSED TABLES', 'byte read from the table; 1140h/1150h share one read (1150h = index 10h and up)')}
      {showOther && section('other', 'OTHER MAPS AND TABLES IN THIS LOG', 'looked up by the firmware but not on either sheet')}
    </div>
  );
});

export default MapsTab;
