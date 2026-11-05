import { useState, useMemo, memo, useContext } from "react";
import {
  ComposedChart, Line, Scatter, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine,
  useXAxisScale, usePlotArea
} from "recharts";
import { thin, syncNearest, inRange } from "./thin.js";
import { CursorLine, CursorContext } from "./cursor.jsx";
import { useZoom, zoomHandlers, ZoomBox, DragArea, ZoomBar } from "./zoom.jsx";
import { prpmToRpm, ntcLinToC, battRawToV, memName } from "./memDefs.js";
import { MemSearch } from "./memSearch.jsx";
import { rpmAtFn } from "./rpmAt.js";

// ─────────────────────────────────────────────────────────────────
//  TIMELINE TAB
//  DME and KLR on one shared time axis. Zoom any chart (see zoom.jsx) to
//  zoom all of them, and the DME and KLR CHARTS tabs with them; click to
//  move the playback scrubber to that time.
//
//  Reads the combined dme_klr_dashboard_tb.v log:
//    DME: [DS] <ms>,<256hex iram>,<p1p2p3>,<ref_rpm>
//    KLR: [DS] <ms>,<256hex ram>,<p1p2>,<tach><klr_ign_out><full_load><ext_trigger><ext_ign>
//    DME: [PHASE] / KLR: [PHASE]  → vertical markers, IGN_OUT pulses
// ─────────────────────────────────────────────────────────────────

// Palette mirrors C in App.jsx
const C = {
  panelBg:'#060e06', panelBg2:'#0a150a', border:'#0d2e0d',
  textDim:'#ccddcc', textBright:'#00ff80', blue:'#44aaff',
};
const PICK_COLS = ['#ffcc44','#44aaff','#ff44aa','#66ff66','#cc66ff','#ff8844','#44cccc','#ff4444'];

// Raw ADC bytes as the firmware stores them. DS dumps can catch a
// muxed channel mid-scan, so short spikes here are sampling, not signal.
const ADCS = [
  {addr:0x10, name:'AFM',       col:'#44cccc'},
  {addr:0x11, name:'BATTERY',   col:'#ffcc44'},
  {addr:0x12, name:'AIR TEMP',  col:'#ff8844'},
  {addr:0x13, name:'COOLANT',   col:'#44aaff'},
  {addr:0x14, name:'ALTITUDE',  col:'#cc66ff'},
  {addr:0x16, name:'TPS',       col:'#66ff66'},
  {addr:0x17, name:'FUEL QUAL', col:'#ff44aa'},
];

// KLR [PHASE] lines that fire every revolution (or, for FULL_LOAD, repeat
// every ~40 ms in real logs) — plotted as data, not markers
const KLR_NOISY_PHASE = /IGN_OUT|Knock pulse|KNOCK_LOGIC|KNOCK_OUT|FULL_LOAD/i;
const MAX_MARKERS = 400;
const MAX_IGN_POINTS = 1500;
const DEFAULT_PICKS = [{src:'dme', addr:0x7D}, {src:'klr', addr:0x33}];
const PICKS_KEY = 'dme951.timeline.picks';
const RPM_PICKS_KEY = 'dme951.timeline.rpmPicks';
const DEFAULT_RPM_PICKS = [{src:'dme', addr:0x7D, unit:'raw'}];

// prpmToRpm (37h × 40 rpm),
// valid for prpm >= 3 once EngineSync (iram[21h].0) has been seen. The bit
// is latched here because real logs show it clearing again after sync
// (21h goes 0x13 → 0x70 at ~1.6 s in warm_idle_5s) while prpm stays valid.
const fwRpm = (ir, synced) => synced ? prpmToRpm(ir[0x37]) : null;
const hx = v => v.toString(16).toUpperCase().padStart(2, '0');
const pickKey = p => `${p.src}_${hx(p.addr)}${p.bit != null ? `_${p.bit}` : ''}`;
const pickLabel = p => {
  const n = memName(p.src, p.addr, p.bit);
  return `${p.src === 'dme' ? 'DME iram' : 'KLR ram'}[${hx(p.addr)}h]${p.bit != null ? `.${p.bit}` : ''}${n ? ` ${n}` : ''}`;
};

// Display units for a picked byte: the chart still plots the raw byte, the
// tooltip shows the converted value (and the raw byte beside it). Each
// conversion returns null where the byte has no meaning in that unit.
const UNITS = {
  raw:   { label: 'raw',             conv: null },
  adcV:  { label: 'V (ADC 0-5 V)',   conv: v => (v * 5 / 255).toFixed(2), unit: 'V',
           note: 'raw × 5/255: the voltage at the ADC input' },
  battV: { label: 'V (battery)',     conv: v => battRawToV(v).toFixed(1), unit: 'V',
           note: 'raw × 0.05263 + 2.132: the DME battery scale (iram 11h), as on the Overview tile' },
  degC:  { label: '°C (NTC)',        conv: v => ntcLinToC(v), unit: '°C',
           note: 'raw × 165/255 − 40: the DME NTC linearised scale (iram 12h/13h after linearisation)' },
  rpm:   { label: 'RPM (prpm)',      conv: v => prpmToRpm(v), unit: 'rpm',
           note: 'raw × 40: DME engine speed prpm (iram 37h), in units of 40 rpm; blank below 3' },
};
// Unit a newly added pick starts with, by what the byte is known to hold
const defaultUnit = (src, addr) =>
  src === 'dme' ? ({ 0x11: 'battV', 0x12: 'degC', 0x13: 'degC', 0x37: 'rpm' }[addr] ?? 'raw') : 'raw';

const fmtPick = (p, v) => {
  if (p.bit != null) return `${v}`;
  const u = UNITS[p.unit ?? 'raw'] ?? UNITS.raw;
  if (!u.conv) return `0x${hx(v)} (${v})`;
  const c = u.conv(v);
  return `${c ?? '--'} ${u.unit}  (0x${hx(v)})`;
};

const LABELS = {
  rpm:'RPM stimulus', fwRpm:'RPM firmware', timingAdv:'advance °BTDC', dwell:'dwell ms',
  ignPulse:'IGN_OUT pulse ms', fuel:'injection ms', isv:'ISV 7Fh',
  klr52:'KLR ram[52h]', klr33:'KLR ram[33h]', fullLoad:'full_load',
};
// Series shown as raw bytes in the tooltip
const HEX_SERIES = /^(adc_|in_|isv$|klr5|klr3|(dme|klr)_[0-9A-F]{2}$)/;

function seriesLabel(k, picks = []) {
  if (LABELS[k]) return LABELS[k];
  const adc = ADCS.find(a => k === `adc_${hx(a.addr)}`);
  if (adc) return `${adc.name} ${hx(adc.addr)}h`;
  const inp = ADCS.find(a => k === `in_${hx(a.addr)}`);
  if (inp) return `${inp.name} input (ch${inp.addr - 0x10})`;
  const p = picks.find(q => pickKey(q) === k);
  return p ? pickLabel(p) : k;
}

// Compact synced tooltip; also lists any PHASE markers within ±60 ms
function TipBox({ active, payload, label, markers, picks = [] }) {
  if (!active || label == null) return null;
  const near = markers.filter(m => Math.abs(m.t - label) <= 60);
  return (
    <div style={{background:'#060e06ee',border:`1px solid ${C.border}`,padding:'4px 7px',fontSize:'10px',lineHeight:1.35}}>
      <div style={{color:C.textBright}}>t={label} ms</div>
      {(payload ?? []).filter(e => e.dataKey !== 't' && e.value != null).map(e => (
        <div key={e.dataKey} style={{color:e.color ?? e.stroke}}>
          {e.name}: {(() => {
            const p = picks.find(q => pickKey(q) === e.dataKey);
            if (p) return fmtPick(p, e.value);
            return HEX_SERIES.test(e.dataKey) ? `0x${hx(e.value)} (${e.value})` : e.value;
          })()}
        </div>
      ))}
      {near.map((m, i) => <div key={i} style={{color:m.col}}>▸ {m.t} ms {m.msg}</div>)}
    </div>
  );
}

// MEMORY vs RPM tooltip: the engine speed, the sample's time, and each
// picked byte at that sample in its chosen unit
function RpmTipBox({ active, payload, label, picks }) {
  if (!active || label == null) return null;
  const row = payload?.[0]?.payload;
  return (
    <div style={{background:'#060e06ee',border:`1px solid ${C.border}`,padding:'4px 7px',fontSize:'10px',lineHeight:1.35}}>
      <div style={{color:C.textBright}}>{Math.round(label)} rpm{row?.t != null && <span style={{color:C.textDim}}> · t={row.t} ms</span>}</div>
      {(payload ?? []).filter(e => e.value != null).map(e => {
        const p = picks.find(q => pickKey(q) === e.dataKey);
        return <div key={e.dataKey} style={{color:e.color ?? e.fill}}>{e.name}: {p ? fmtPick(p, e.value) : e.value}</div>;
      })}
    </div>
  );
}

// The playback cursor on the MEMORY vs RPM chart: a line at the engine
// speed at the scrubber time
function RpmCursor({ rpmAt, ...props }) {
  const t = useContext(CursorContext);
  const r = t == null ? null : rpmAt(t);
  return r > 0 ? <ReferenceLine yAxisId="l" x={r} {...props} /> : null;
}

function loadPicks(key = PICKS_KEY, dflt = DEFAULT_PICKS) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    if (Array.isArray(v)) return v;
  } catch { /* storage unavailable */ }
  return dflt;
}
function savePicks(p, key = PICKS_KEY) {
  try { localStorage.setItem(key, JSON.stringify(p)); } catch { /* storage unavailable */ }
}

// A picker's chips (with unit selectors and remove buttons) and its
// DME/KLR address search. picks/setPicks: that picker's list (setPicks
// also saves it); chip: the legend chip that toggles a series.
function PickBar({ title, picks, setPicks, hasKlr, chip, inp, btn }) {
  const [src, setSrc] = useState('dme');
  const [addr, setAddr] = useState('');     // search text: hex address or name
  const [bit, setBit] = useState('');
  const addAt = (a, b) => {
    if (isNaN(a) || a < 0 || a > 0x7F || (b != null && (isNaN(b) || b < 0 || b > 7))) return;
    const p = { src, addr: a, ...(b != null ? { bit: b } : { unit: defaultUnit(src, a) }) };
    setAddr(''); setBit('');
    if (picks.some(q => pickKey(q) === pickKey(p))) return;
    setPicks([...picks, p]);
  };
  // ADD / Enter: the text as a hex address (Enter on a highlighted search match picks that)
  const bitIn = () => bit === '' ? null : parseInt(bit, 10);
  const add = () => addAt(parseInt(addr.replace(/^0x/i, '').replace(/h$/i, ''), 16), bitIn());
  const pickMatch = (m, byKey) => addAt(m.addr, (byKey ? bitIn() : null) ?? m.bit ?? null);
  const remove = k => setPicks(picks.filter(p => pickKey(p) !== k));
  const setUnit = (k, unit) => setPicks(picks.map(p => pickKey(p) === k ? { ...p, unit } : p));
  return (<>
    {title}
    {picks.map((p, i) => (
      <span key={pickKey(p)} style={{display:'inline-flex',gap:'4px',alignItems:'center'}}>
        {chip(pickKey(p), pickLabel(p), PICK_COLS[i % PICK_COLS.length])}
        {p.bit == null &&
          <select value={p.unit ?? 'raw'} onChange={e => setUnit(pickKey(p), e.target.value)}
                  title={`Tooltip unit${UNITS[p.unit]?.note ? ` — ${UNITS[p.unit].note}` : ''}`}
                  style={{...inp,padding:'1px 2px',fontSize:'9px',textTransform:'none',letterSpacing:0}}>
            {Object.entries(UNITS).map(([k, u]) => <option key={k} value={k}>{u.label}</option>)}
          </select>}
        <span onClick={() => remove(pickKey(p))} style={{cursor:'pointer',color:'#886666'}} title="Remove">✕</span>
      </span>
    ))}
    <span style={{display:'inline-flex',gap:'4px',alignItems:'center',marginLeft:'auto',textTransform:'none',letterSpacing:0}}>
      <select value={src} onChange={e => setSrc(e.target.value)} style={inp}>
        <option value="dme">DME iram</option>
        <option value="klr" disabled={!hasKlr}>KLR ram</option>
      </select>
      <MemSearch src={src} value={addr} onChange={setAddr} onPick={pickMatch} onEnter={add}
                 style={{...inp,width:'170px'}} />
      <input value={bit} onChange={e => setBit(e.target.value)} placeholder="bit"
             onKeyDown={e => e.key === 'Enter' && add()} style={{...inp,width:'32px'}} />
      <button style={btn} onClick={add}>ADD</button>
    </span>
  </>);
}

// Memoized: live mode re-renders the page on every sim tick
// range/setRange: the zoom shared with the other chart tabs ([t0, t1] or null = whole log)
const TimelineTab = memo(function TimelineTab({ chartData, dmeSnapshots, dmePhases, klrData, onSeek, range, setRange }) {
  const [showDmeMk, setShowDmeMk] = useState(true);
  const [showKlrMk, setShowKlrMk] = useState(true);
  const [hidden, setHidden] = useState({});     // series key → true when hidden
  const [picks, setPicksRaw] = useState(() => loadPicks());
  const setPicks = p => { setPicksRaw(p); savePicks(p); };
  // MEMORY vs RPM: its own picks, plotted against engine speed
  const [rpmPicks, setRpmPicksRaw] = useState(() => loadPicks(RPM_PICKS_KEY, DEFAULT_RPM_PICKS));
  const setRpmPicks = p => { setRpmPicksRaw(p); savePicks(p, RPM_PICKS_KEY); };
  const [rpmRange, setRpmRange] = useState(null);   // MEMORY vs RPM zoom: [rpm0, rpm1] or null

  // ── One row per timestamp, DME and KLR DS snapshots merged ────
  const rows = useMemo(() => {
    const byT = new Map();
    const row = t => { if (!byT.has(t)) byT.set(t, { t }); return byT.get(t); };
    for (const d of chartData) Object.assign(row(d.t), {
      rpm: d.rpm, fuel: d.fuel, isv: d.isv, dwell: d.dwell, timingAdv: d.timingAdv,
    });
    let synced = false;
    for (const s of dmeSnapshots) {
      if (s.raw?.includes('[STATUS]')) continue;   // DS only: full iram, raw ADC bytes
      const r = row(s.t), ir = s.iram;
      if ((ir[0x21] ?? 0) & 1) synced = true;
      r.fwRpm = fwRpm(ir, synced);
      for (const a of ADCS) r[`adc_${hx(a.addr)}`] = ir[a.addr] ?? null;
      // ADC channel inputs (channel = iram address - 10h), newer logs only
      if (s.adcIn) for (const a of ADCS) r[`in_${hx(a.addr)}`] = s.adcIn[a.addr - 0x10];
      for (const p of picks) if (p.src === 'dme') {
        const v = ir[p.addr];
        r[pickKey(p)] = v == null ? null : p.bit != null ? (v >> p.bit) & 1 : v;
      }
    }
    for (const s of klrData.snapshots ?? []) {
      const r = row(s.t);
      r.klr52 = s.ram[0x52] ?? null;
      r.klr33 = s.ram[0x33] ?? null;
      const bits = s.extra ?? '';
      r.fullLoad = /^[01]$/.test(bits[2] ?? '') ? +bits[2] : null;
      for (const p of picks) if (p.src === 'klr') {
        const v = s.ram[p.addr];
        r[pickKey(p)] = v == null ? null : p.bit != null ? (v >> p.bit) & 1 : v;
      }
    }
    return [...byT.values()].sort((a, b) => a.t - b.t);
  }, [chartData, dmeSnapshots, klrData.snapshots, picks]);

  const tMin = rows[0]?.t ?? 0, tMax = rows[rows.length - 1]?.t ?? 0;
  const [t0, t1] = range ?? [tMin, tMax];
  const full = useMemo(() => [tMin, tMax], [tMin, tMax]);
  const zoom = useZoom(range, setRange, full, onSeek);

  // Rows in the zoom range (plus one either side so lines reach the edges),
  // thinned per chart to the series it draws
  const pickSig = picks.map(pickKey).join(',');
  const hasAdcIn = useMemo(() => dmeSnapshots.some(s => s.adcIn), [dmeSnapshots]);
  const shown = useMemo(() => {
    const vis = inRange(rows, [t0, t1]);
    return {
      rpm:   thin(vis, ['rpm', 'fwRpm']),
      ign:   thin(vis, ['timingAdv', 'dwell']),
      fuel:  thin(vis, ['fuel', 'isv']),
      adc:   thin(vis, ADCS.map(x => `adc_${hx(x.addr)}`)),
      adcIn: thin(vis, ADCS.map(x => `in_${hx(x.addr)}`)),
      klr:   thin(vis, ['klr52', 'klr33', 'fullLoad']),
      picks: thin(vis, pickSig ? pickSig.split(',') : []),
    };
  }, [rows, t0, t1, pickSig]);

  // ── Event markers ─────────────────────────────────────────────
  const markers = useMemo(() => {
    const out = [];
    if (showDmeMk) for (const p of dmePhases) out.push({ t: p.t, msg: p.msg, col: '#ffaa00' });
    if (showKlrMk) for (const p of klrData.phases ?? [])
      if (p.cat === 'klr' && !KLR_NOISY_PHASE.test(p.msg)) out.push({ t: p.t, msg: p.msg, col: C.blue });
    return out.filter(m => m.t >= t0 && m.t <= t1);
  }, [dmePhases, klrData.phases, showDmeMk, showKlrMk, t0, t1]);
  const shownMarkers = markers.slice(0, MAX_MARKERS);

  // IGN_OUT pulses from KLR [PHASE] deasserted lines (carry pulse_width).
  // Strided when zoomed out so thousands of points don't stall the SVG.
  const ignPts = useMemo(() => {
    const all = (klrData.phases ?? []).filter(p =>
      p.cat === 'klr' && p.deasserted && p.pulse_ms != null && p.t >= t0 && p.t <= t1);
    const step = Math.max(1, Math.ceil(all.length / MAX_IGN_POINTS));
    return { total: all.length, pts: all.filter((_, i) => i % step === 0).map(p => ({ t: p.t, ignPulse: +p.pulse_ms.toFixed(3) })) };
  }, [klrData.phases, t0, t1]);

  // ── MEMORY vs RPM ─────────────────────────────────────────────
  // Engine speed at any time from the DME's rpm (as the KLR RPM MAPS tab
  // does): a DME sample gets its own snapshot's rpm, a KLR sample the DME
  // rpm at its time (linear between DME samples, none across a 500 ms gap).
  // Only samples inside the Timeline's time zoom are plotted.
  const rpmAt = useMemo(() => rpmAtFn(chartData.filter(d => d.rpm != null).map(d => ({ t: d.t, rpm: d.rpm }))), [chartData]);
  const rpmPickSig = rpmPicks.map(pickKey).join(',');
  const rpmRows = useMemo(() => {
    const out = [];
    const add = (t, ram, src) => {
      const ps = rpmPicks.filter(p => p.src === src);
      if (!ps.length || !ram || t < t0 || t > t1) return;
      const r = rpmAt(t);
      if (!(r > 0)) return;
      const row = { t, rpm: Math.round(r) };
      for (const p of ps) {
        const v = ram[p.addr];
        row[pickKey(p)] = v == null ? null : p.bit != null ? (v >> p.bit) & 1 : v;
      }
      out.push(row);
    };
    for (const s of dmeSnapshots) if (!s.raw?.includes('[STATUS]')) add(s.t, s.iram, 'dme');
    for (const s of klrData.snapshots ?? []) add(s.t, s.ram, 'klr');
    return out.sort((a, b) => a.rpm - b.rpm || a.t - b.t);
  }, [dmeSnapshots, klrData.snapshots, rpmPicks, rpmAt, t0, t1]);
  const rpmLo = rpmRows[0]?.rpm, rpmHi = rpmRows[rpmRows.length - 1]?.rpm;
  const rpmFull = useMemo(() => rpmLo != null && rpmHi > rpmLo ? [rpmLo, rpmHi] : null, [rpmLo, rpmHi]);
  const rpmZoom = useZoom(rpmRange, setRpmRange, rpmFull);
  const rpmShown = useMemo(() => thin(inRange(rpmRows, rpmRange, 'rpm'), rpmPickSig ? rpmPickSig.split(',') : []),
                           [rpmRows, rpmRange, rpmPickSig]);

  if (!rows.length) return (
    <div style={{textAlign:'center',color:C.textDim,padding:'60px',fontSize:'14px'}}>
      No snapshot data loaded — use LOAD LOG to parse a log file
    </div>
  );

  const hasKlr = (klrData.snapshots?.length ?? 0) > 0;
  const hasBits = picks.some(p => p.bit != null);
  const ax = {fill:C.textDim,fontSize:10,fontFamily:"'Share Tech Mono',monospace"};
  const panel = {background:C.panelBg,border:`1px solid ${C.border}`,borderRadius:'2px',padding:'8px 10px',marginBottom:'8px'};
  const title = {color:C.textDim,fontSize:'9px',letterSpacing:'0.2em',textTransform:'uppercase',marginBottom:'4px',
                 display:'flex',gap:'12px',alignItems:'center',flexWrap:'wrap'};
  const btn = {padding:'3px 10px',background:C.panelBg2,border:`1px solid ${C.border}`,color:C.textDim,
               fontFamily:'inherit',fontSize:'10px',cursor:'pointer'};
  const inp = {background:'#030803',border:`1px solid ${C.border}`,color:C.textBright,fontFamily:'inherit',
               fontSize:'10px',padding:'3px 5px'};

  // Legend chip that toggles a series on/off
  const chip = (k, label, col) => (
    <span key={k} onClick={() => setHidden(h => ({ ...h, [k]: !h[k] }))}
      style={{cursor:'pointer',color:hidden[k] ? '#446644' : col,textDecoration:hidden[k] ? 'line-through' : 'none',
              letterSpacing:'0.05em',textTransform:'none'}}>
      ■ {label}
    </span>
  );

  // MEMORY vs RPM chips hide its own dots, not the same byte on the time chart
  const rpmChip = (k, label, col) => chip(`rpm:${k}`, label, col);

  // Every chart gets a right axis of the same width so the plot areas,
  // and therefore the time axes, line up vertically.
  const chart = (data, height, children, yAxes, rightAxis) => (
    <ZoomBox zoom={zoom}><ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} syncId="timeline" syncMethod={syncNearest}
        margin={{top:4,right:8,bottom:0,left:0}} {...zoomHandlers(zoom)}>
        <CartesianGrid strokeDasharray="2 4" stroke="#0d2e0d" />
        <XAxis dataKey="t" type="number" domain={[t0, t1]} allowDataOverflow tick={ax}
               tickFormatter={v => `${v}ms`} stroke={C.textDim} />
        {yAxes}
        {rightAxis ?? <YAxis yAxisId="r" orientation="right" width={36} tick={false} axisLine={false} />}
        <Tooltip content={<TipBox markers={markers} picks={picks} />} isAnimationActive={false} />
        <MarkerLines markers={shownMarkers} />
        <CursorLine stroke={C.textBright} strokeWidth={1.5} />
        <DragArea zoom={zoom} fill={C.textBright} />
        {children}
      </ComposedChart>
    </ResponsiveContainer></ZoomBox>
  );
  const line = (k, col, axis = 'l', extra = {}) => !hidden[k] && (
    <Line key={k} yAxisId={axis} dataKey={k} name={seriesLabel(k, picks)} stroke={col} dot={false} strokeWidth={1.4}
          isAnimationActive={false} connectNulls type="linear" {...extra} />
  );

  return (
    <div style={{userSelect:'none'}}>
      {/* ── Controls ─────────────────────────────────────────── */}
      <div style={{...panel,display:'flex',gap:'14px',alignItems:'center',flexWrap:'wrap'}}>
        <ZoomBar zoom={zoom} range={range} full={full} btn={btn} color={C.textBright} dim={C.textDim} hint={false} />
        <label style={{color:'#ffaa00',fontSize:'10px',cursor:'pointer'}}>
          <input type="checkbox" checked={showDmeMk} onChange={e => setShowDmeMk(e.target.checked)} /> DME PHASE
        </label>
        <label style={{color:C.blue,fontSize:'10px',cursor:'pointer'}}>
          <input type="checkbox" checked={showKlrMk} onChange={e => setShowKlrMk(e.target.checked)} /> KLR PHASE
        </label>
        {markers.length > MAX_MARKERS &&
          <span style={{color:'#ffaa00',fontSize:'9px'}}>showing first {MAX_MARKERS} of {markers.length} markers — zoom in for the rest</span>}
        <span style={{color:C.textDim,fontSize:'9px',marginLeft:'auto'}}>drag to zoom · ctrl+wheel zoom · shift+wheel pan · double-click reset · click to move scrubber</span>
      </div>

      {/* ── RPM ──────────────────────────────────────────────── */}
      <div style={panel}>
        <div style={title}>ENGINE SPEED (RPM)
          {chip("rpm", "stimulus (ref sensor)", C.textBright)}
          {chip("fwRpm", "firmware prpm(37h)", "#ffaa00")}
        </div>
        {chart(shown.rpm, 140, [line('rpm', C.textBright), line('fwRpm', '#ffaa00', 'l', {strokeDasharray:'4 2'})],
          <YAxis yAxisId="l" tick={ax} stroke={C.textDim} domain={[0, 'auto']} width={44} />)}
      </div>

      {/* ── Ignition ─────────────────────────────────────────── */}
      <div style={panel}>
        <div style={title}>IGNITION
          {chip("timingAdv", "advance 31h+57h (°BTDC)", "#ff4444")}
          {chip("dwell", "dwell 2Fh (ms)", "#ff8844")}
          {chip("ignPulse", `KLR IGN_OUT pulse (ms)${ignPts.total > ignPts.pts.length ? ` · 1 in ${Math.ceil(ignPts.total / ignPts.pts.length)}` : ''}`, "#ffcc44")}
        </div>
        {chart(shown.ign, 150, [
          line('timingAdv', '#ff4444'),
          line('dwell', '#ff8844', 'r'),
          !hidden.ignPulse && <Scatter key="ign" yAxisId="r" data={ignPts.pts} dataKey="ignPulse" name={seriesLabel('ignPulse')}
                                       fill="#ffcc44" shape={<IgnTick />} isAnimationActive={false} />,
        ],
          <YAxis yAxisId="l" tick={ax} stroke={C.textDim} domain={[0, 'auto']} width={44} />,
          <YAxis yAxisId="r" orientation="right" tick={ax} stroke="#ff8844" domain={[0, 'auto']} width={36} />)}
      </div>

      {/* ── Fuel / ISV ───────────────────────────────────────── */}
      <div style={panel}>
        <div style={title}>FUEL / IDLE
          {chip("fuel", "injection 4B:4Ah (ms)", "#66ff66")}
          {chip("isv", "ISV 7Fh", "#ff44aa")}
        </div>
        {chart(shown.fuel, 130, [line('fuel', '#66ff66'), line('isv', '#ff44aa', 'r')],
          <YAxis yAxisId="l" tick={ax} stroke={C.textDim} domain={[0, 'auto']} width={44} />,
          <YAxis yAxisId="r" orientation="right" tick={ax} stroke="#ff44aa" domain={[0, 255]} width={36} />)}
      </div>

      {/* ── ADCs ─────────────────────────────────────────────── */}
      <div style={panel}>
        <div style={title}>ADC RAW (ADC inputs)
          {hasAdcIn && ADCS.map(a => chip(`in_${hx(a.addr)}`, `${a.name} ch${a.addr - 0x10}`, a.col))}
        </div>
        {hasAdcIn
          ? chart(shown.adcIn, 170, ADCS.map(a => line(`in_${hx(a.addr)}`, a.col)),
              <YAxis yAxisId="l" tick={ax} stroke={C.textDim} domain={[0, 255]} width={44} />)
          : <div style={{color:C.textDim, fontSize:'10px', padding:'12px 4px'}}>
              This log has no ADC input field in its DME [DS] lines (it is from an older testbench),
              so only the values the firmware stored in RAM are shown below.
            </div>}
      </div>
      <div style={panel}>
        <div style={title}>ADC VALUES IN DME RAM (10h–17h)
          {ADCS.map(a => chip(`adc_${hx(a.addr)}`, `${a.name} ${hx(a.addr)}h`, a.col))}
        </div>
        {chart(shown.adc, 170, ADCS.map(a => line(`adc_${hx(a.addr)}`, a.col)),
          <YAxis yAxisId="l" tick={ax} stroke={C.textDim} domain={[0, 255]} width={44} />)}
        <div style={{color:C.textDim, fontSize:'8px', marginTop:'2px'}}>
          The firmware's copies, not the ADC itself. Air temp 12h and coolant 13h are linearised in
          place (0x2DD–0x2ED), so a snapshot taken between the ADC read and that step shows the raw
          input: that is the jumping between two levels.
        </div>
      </div>

      {/* ── KLR ──────────────────────────────────────────────── */}
      {hasKlr && (
        <div style={panel}>
          <div style={title}>KLR
            {chip("klr52", "MAP ram[52h]", C.blue)}
            {chip("klr33", "DTC ram[33h]", "#ff4444")}
            {chip("fullLoad", "full_load pin", "#66ff66")}
          </div>
          {chart(shown.klr, 140, [line('klr52', C.blue), line('klr33', '#ff4444'),
                       line('fullLoad', '#66ff66', 'r', {type:'stepAfter'})],
          <YAxis yAxisId="l" tick={ax} stroke={C.textDim} domain={[0, 255]} width={44} />,
          <YAxis yAxisId="r" orientation="right" tick={ax} stroke="#66ff66" domain={[0, 1]} ticks={[0, 1]} width={36} />)}
        </div>
      )}

      {/* ── Byte picker ──────────────────────────────────────── */}
      <div style={panel}>
        <div style={title}>
          <PickBar title="MEMORY PICKER" picks={picks} setPicks={setPicks} hasKlr={hasKlr} chip={chip} inp={inp} btn={btn} />
        </div>
        {picks.length > 0 && chart(shown.picks, 170, [
          ...picks.filter(p => p.bit == null).map(p => line(pickKey(p), PICK_COLS[picks.indexOf(p) % PICK_COLS.length])),
          ...picks.filter(p => p.bit != null).map(p => line(pickKey(p), PICK_COLS[picks.indexOf(p) % PICK_COLS.length], 'r', {type:'stepAfter'})),
        ],
          <YAxis yAxisId="l" tick={ax} stroke={C.textDim} domain={[0, 255]} width={44} tickFormatter={v => `${hx(v)}h`} />,
          <YAxis yAxisId="r" orientation="right" tick={hasBits && ax} axisLine={hasBits} stroke={C.textDim} domain={[0, 1]} ticks={[0, 1]} width={36} />)}
      </div>

      {/* ── Memory vs RPM ────────────────────────────────────── */}
      <div style={panel}>
        <div style={title}>
          <PickBar title="MEMORY vs RPM" picks={rpmPicks} setPicks={setRpmPicks} hasKlr={hasKlr} chip={rpmChip} inp={inp} btn={btn} />
        </div>
        <div style={{display:'flex',gap:'12px',alignItems:'center',flexWrap:'wrap',marginBottom:'2px'}}>
          <ZoomBar zoom={rpmZoom} range={rpmRange} full={rpmFull} btn={btn} color={C.textBright} dim={C.textDim} unit="rpm" />
          <span style={{color:C.textDim,fontSize:'8px'}}>
            One dot per snapshot in {range ? 'the zoomed time span' : 'the whole log'}. KLR bytes are placed at the DME's engine speed at the same time.
          </span>
        </div>
        {rpmPicks.length > 0 && (rpmShown.length ? (
          <ZoomBox zoom={rpmZoom}><ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={rpmShown} margin={{top:4,right:8,bottom:0,left:0}} {...zoomHandlers(rpmZoom)}>
              <CartesianGrid strokeDasharray="2 4" stroke="#0d2e0d" />
              <XAxis dataKey="rpm" type="number" domain={rpmRange ?? rpmFull ?? ['auto', 'auto']} allowDataOverflow tick={ax}
                     tickFormatter={v => `${v}`} stroke={C.textDim} />
              <YAxis yAxisId="l" tick={ax} stroke={C.textDim} domain={[0, 255]} width={44} tickFormatter={v => `${hx(v)}h`} />
              <YAxis yAxisId="r" orientation="right" tick={rpmPicks.some(p => p.bit != null) && ax}
                     axisLine={rpmPicks.some(p => p.bit != null)} stroke={C.textDim} domain={[0, 1]} ticks={[0, 1]} width={36} />
              <Tooltip content={<RpmTipBox picks={rpmPicks} />} isAnimationActive={false} />
              <RpmCursor rpmAt={rpmAt} stroke={C.textBright} strokeDasharray="3 3" />
              <DragArea zoom={rpmZoom} fill={C.textBright} />
              {rpmPicks.map((p, i) => !hidden[`rpm:${pickKey(p)}`] && (
                <Line key={pickKey(p)} yAxisId={p.bit != null ? 'r' : 'l'} dataKey={pickKey(p)} name={pickLabel(p)}
                      stroke="none" dot={{ r: 1.5, fill: PICK_COLS[i % PICK_COLS.length], stroke: 'none' }}
                      activeDot={{ r: 3 }} isAnimationActive={false} />
              ))}
            </ComposedChart>
          </ResponsiveContainer></ZoomBox>
        ) : (
          <div style={{color:C.textDim, fontSize:'10px', padding:'12px 4px'}}>
            No samples with an engine speed {range ? 'in the zoomed time span' : 'in this log'} yet.
          </div>
        ))}
      </div>
    </div>
  );
});

// PHASE markers drawn as one dashed SVG path per colour. As <ReferenceLine>s
// each marker was its own chart-store subscriber, and hundreds of them per
// chart made the tab take tens of seconds to render.
function MarkerLines({ markers }) {
  const x = useXAxisScale();
  const area = usePlotArea();
  if (!x || !area) return null;
  const lo = area.x, hi = area.x + area.width;
  const paths = {};
  for (const m of markers) {
    const px = x(m.t);
    if (px == null || px < lo || px > hi) continue;
    paths[m.col] = (paths[m.col] ?? '') + `M${px.toFixed(1)},${area.y}v${area.height}`;
  }
  return (
    <g className="timeline-markers" pointerEvents="none">
      {Object.entries(paths).map(([col, d]) => (
        <path key={col} d={d} stroke={col} strokeOpacity={0.45} strokeDasharray="2 3" fill="none" />
      ))}
    </g>
  );
}

// Short vertical tick for each IGN_OUT pulse
function IgnTick({ cx, cy, fill }) {
  if (cx == null || cy == null) return null;
  return <line x1={cx} x2={cx} y1={cy - 4} y2={cy + 4} stroke={fill} strokeWidth={1} />;
}

export default TimelineTab;
