import { useState, useMemo, useCallback } from "react";
import {
  ComposedChart, Line, Scatter, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine, ReferenceArea
} from "recharts";

// ─────────────────────────────────────────────────────────────────
//  TIMELINE TAB
//  DME and KLR on one shared time axis. Drag across any chart to zoom
//  all of them; click to move the playback scrubber to that time.
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
const MAX_IGN_POINTS = 3000;
const DEFAULT_PICKS = [{src:'dme', addr:0x7D}, {src:'klr', addr:0x33}];
const PICKS_KEY = 'dme951.timeline.picks';

// Same conversion as prpmToRpm in App.jsx: prpm=21 @ 840 RPM → K=17640,
// valid for prpm >= 3 once EngineSync (iram[21h].0) has been seen. The bit
// is latched here because real logs show it clearing again after sync
// (21h goes 0x13 → 0x70 at ~1.6 s in warm_idle_5s) while prpm stays valid.
const fwRpm = (ir, synced) => synced && ir[0x37] >= 3 ? Math.round(17640 / ir[0x37]) : null;
const hx = v => v.toString(16).toUpperCase().padStart(2, '0');
const pickKey = p => `${p.src}_${hx(p.addr)}${p.bit != null ? `_${p.bit}` : ''}`;
const pickLabel = p => `${p.src === 'dme' ? 'DME iram' : 'KLR ram'}[${hx(p.addr)}h]${p.bit != null ? `.${p.bit}` : ''}`;

const LABELS = {
  rpm:'RPM stimulus', fwRpm:'RPM firmware', timingAdv:'advance °BTDC', dwell:'dwell ms',
  ignPulse:'IGN_OUT pulse ms', fuel:'injection ms', isv:'ISV 7Fh',
  klr52:'KLR ram[52h]', klr33:'KLR ram[33h]', fullLoad:'full_load',
};
// Series shown as raw bytes in the tooltip
const HEX_SERIES = /^(adc_|isv$|klr5|klr3|(dme|klr)_[0-9A-F]{2}$)/;

function seriesLabel(k, picks = []) {
  if (LABELS[k]) return LABELS[k];
  const adc = ADCS.find(a => k === `adc_${hx(a.addr)}`);
  if (adc) return `${adc.name} ${hx(adc.addr)}h`;
  const p = picks.find(q => pickKey(q) === k);
  return p ? pickLabel(p) : k;
}

// Compact synced tooltip; also lists any PHASE markers within ±60 ms
function TipBox({ active, payload, label, markers }) {
  if (!active || label == null) return null;
  const near = markers.filter(m => Math.abs(m.t - label) <= 60);
  return (
    <div style={{background:'#060e06ee',border:`1px solid ${C.border}`,padding:'4px 7px',fontSize:'10px',lineHeight:1.35}}>
      <div style={{color:C.textBright}}>t={label} ms</div>
      {(payload ?? []).filter(e => e.dataKey !== 't' && e.value != null).map(e => (
        <div key={e.dataKey} style={{color:e.color ?? e.stroke}}>
          {e.name}: {HEX_SERIES.test(e.dataKey) ? `0x${hx(e.value)} (${e.value})` : e.value}
        </div>
      ))}
      {near.map((m, i) => <div key={i} style={{color:m.col}}>▸ {m.t} ms {m.msg}</div>)}
    </div>
  );
}

function loadPicks() {
  try {
    const v = JSON.parse(localStorage.getItem(PICKS_KEY));
    if (Array.isArray(v)) return v;
  } catch { /* storage unavailable */ }
  return DEFAULT_PICKS;
}
function savePicks(p) {
  try { localStorage.setItem(PICKS_KEY, JSON.stringify(p)); } catch { /* storage unavailable */ }
}

export default function TimelineTab({ chartData, dmeSnapshots, dmePhases, klrData, currentT, onSeek }) {
  const [range, setRange]   = useState(null);   // [t0, t1] or null = whole log
  const [drag, setDrag]     = useState(null);   // {a, b} while selecting
  const [showDmeMk, setShowDmeMk] = useState(true);
  const [showKlrMk, setShowKlrMk] = useState(true);
  const [hidden, setHidden] = useState({});     // series key → true when hidden
  const [picks, setPicks]   = useState(loadPicks);
  const [pickSrc, setPickSrc]   = useState('dme');
  const [pickAddr, setPickAddr] = useState('');
  const [pickBit, setPickBit]   = useState('');

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

  // ── Drag to zoom, click to seek ──────────────────────────────
  const onDown = useCallback(e => { if (e?.activeLabel != null) setDrag({ a: +e.activeLabel, b: +e.activeLabel }); }, []);
  const onMove = useCallback(e => { if (e?.activeLabel != null) setDrag(d => d && { ...d, b: +e.activeLabel }); }, []);
  const onUp   = useCallback(() => {
    setDrag(d => {
      if (d) {
        const lo = Math.min(d.a, d.b), hi = Math.max(d.a, d.b);
        if (hi - lo > 0) setRange([lo, hi]);
        else onSeek?.(lo);
      }
      return null;
    });
  }, [onSeek]);

  const addPick = () => {
    const addr = parseInt(pickAddr, 16);
    const bit = pickBit === '' ? null : parseInt(pickBit, 10);
    if (isNaN(addr) || addr < 0 || addr > 0x7F || (bit != null && (isNaN(bit) || bit < 0 || bit > 7))) return;
    const p = { src: pickSrc, addr, ...(bit != null ? { bit } : {}) };
    if (picks.some(q => pickKey(q) === pickKey(p))) return;
    const next = [...picks, p];
    setPicks(next); savePicks(next); setPickAddr(''); setPickBit('');
  };
  const removePick = k => { const next = picks.filter(p => pickKey(p) !== k); setPicks(next); savePicks(next); };

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

  // Every chart gets a right axis of the same width so the plot areas,
  // and therefore the time axes, line up vertically.
  const chart = (height, children, yAxes, rightAxis) => (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} syncId="timeline" syncMethod="value"
        margin={{top:4,right:8,bottom:0,left:0}}
        onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}>
        <CartesianGrid strokeDasharray="2 4" stroke="#0d2e0d" />
        <XAxis dataKey="t" type="number" domain={[t0, t1]} allowDataOverflow tick={ax}
               tickFormatter={v => `${v}ms`} stroke={C.textDim} />
        {yAxes}
        {rightAxis ?? <YAxis yAxisId="r" orientation="right" width={36} tick={false} axisLine={false} />}
        <Tooltip content={<TipBox markers={markers} />} isAnimationActive={false} />
        {shownMarkers.map((m, i) => (
          <ReferenceLine key={i} yAxisId="l" x={m.t} stroke={m.col} strokeOpacity={0.45} strokeDasharray="2 3"
                         ifOverflow="hidden" />
        ))}
        {currentT != null && <ReferenceLine yAxisId="l" x={currentT} stroke={C.textBright} strokeWidth={1.5} ifOverflow="hidden" />}
        {drag && <ReferenceArea yAxisId="l" x1={Math.min(drag.a, drag.b)} x2={Math.max(drag.a, drag.b)}
                                fill={C.textBright} fillOpacity={0.12} ifOverflow="hidden" />}
        {children}
      </ComposedChart>
    </ResponsiveContainer>
  );
  const line = (k, col, axis = 'l', extra = {}) => !hidden[k] && (
    <Line key={k} yAxisId={axis} dataKey={k} name={seriesLabel(k, picks)} stroke={col} dot={false} strokeWidth={1.4}
          isAnimationActive={false} connectNulls type="linear" {...extra} />
  );

  return (
    <div style={{userSelect:'none'}}>
      {/* ── Controls ─────────────────────────────────────────── */}
      <div style={{...panel,display:'flex',gap:'14px',alignItems:'center',flexWrap:'wrap'}}>
        <span style={{color:C.textBright,fontSize:'11px'}}>
          {range ? `ZOOM ${t0}–${t1} ms` : `ALL ${tMin}–${tMax} ms`}
        </span>
        {range && <button style={btn} onClick={() => setRange(null)}>RESET ZOOM</button>}
        <label style={{color:'#ffaa00',fontSize:'10px',cursor:'pointer'}}>
          <input type="checkbox" checked={showDmeMk} onChange={e => setShowDmeMk(e.target.checked)} /> DME PHASE
        </label>
        <label style={{color:C.blue,fontSize:'10px',cursor:'pointer'}}>
          <input type="checkbox" checked={showKlrMk} onChange={e => setShowKlrMk(e.target.checked)} /> KLR PHASE
        </label>
        {markers.length > MAX_MARKERS &&
          <span style={{color:'#ffaa00',fontSize:'9px'}}>showing first {MAX_MARKERS} of {markers.length} markers — zoom in for the rest</span>}
        <span style={{color:C.textDim,fontSize:'9px',marginLeft:'auto'}}>drag to zoom · click to move scrubber</span>
      </div>

      {/* ── RPM ──────────────────────────────────────────────── */}
      <div style={panel}>
        <div style={title}>ENGINE SPEED (RPM)
          {chip("rpm", "stimulus (ref sensor)", C.textBright)}
          {chip("fwRpm", "firmware prpm(37h)", "#ffaa00")}
        </div>
        {chart(140, [line('rpm', C.textBright), line('fwRpm', '#ffaa00', 'l', {strokeDasharray:'4 2'})],
          <YAxis yAxisId="l" tick={ax} stroke={C.textDim} domain={[0, 'auto']} width={44} />)}
      </div>

      {/* ── Ignition ─────────────────────────────────────────── */}
      <div style={panel}>
        <div style={title}>IGNITION
          {chip("timingAdv", "advance 31h (°BTDC)", "#ff4444")}
          {chip("dwell", "dwell 2Fh (ms)", "#ff8844")}
          {chip("ignPulse", `KLR IGN_OUT pulse (ms)${ignPts.total > ignPts.pts.length ? ` · 1 in ${Math.ceil(ignPts.total / ignPts.pts.length)}` : ''}`, "#ffcc44")}
        </div>
        {chart(150, [
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
        {chart(130, [line('fuel', '#66ff66'), line('isv', '#ff44aa', 'r')],
          <YAxis yAxisId="l" tick={ax} stroke={C.textDim} domain={[0, 'auto']} width={44} />,
          <YAxis yAxisId="r" orientation="right" tick={ax} stroke="#ff44aa" domain={[0, 255]} width={36} />)}
      </div>

      {/* ── ADCs ─────────────────────────────────────────────── */}
      <div style={panel}>
        <div style={title}>ADC RAW (DME iram)
          {ADCS.map(a => chip(`adc_${hx(a.addr)}`, `${a.name} ${hx(a.addr)}h`, a.col))}
        </div>
        {chart(170, ADCS.map(a => line(`adc_${hx(a.addr)}`, a.col)),
          <YAxis yAxisId="l" tick={ax} stroke={C.textDim} domain={[0, 255]} width={44} />)}
      </div>

      {/* ── KLR ──────────────────────────────────────────────── */}
      {hasKlr && (
        <div style={panel}>
          <div style={title}>KLR
            {chip("klr52", "MAP ram[52h]", C.blue)}
            {chip("klr33", "DTC ram[33h]", "#ff4444")}
            {chip("fullLoad", "full_load pin", "#66ff66")}
          </div>
          {chart(140, [line('klr52', C.blue), line('klr33', '#ff4444'),
                       line('fullLoad', '#66ff66', 'r', {type:'stepAfter'})],
          <YAxis yAxisId="l" tick={ax} stroke={C.textDim} domain={[0, 255]} width={44} />,
          <YAxis yAxisId="r" orientation="right" tick={ax} stroke="#66ff66" domain={[0, 1]} ticks={[0, 1]} width={36} />)}
        </div>
      )}

      {/* ── Byte picker ──────────────────────────────────────── */}
      <div style={panel}>
        <div style={title}>MEMORY PICKER
          {picks.map((p, i) => (
            <span key={pickKey(p)} style={{display:'inline-flex',gap:'4px',alignItems:'center'}}>
              {chip(pickKey(p), pickLabel(p), PICK_COLS[i % PICK_COLS.length])}
              <span onClick={() => removePick(pickKey(p))} style={{cursor:'pointer',color:'#886666'}} title="Remove">✕</span>
            </span>
          ))}
          <span style={{display:'inline-flex',gap:'4px',alignItems:'center',marginLeft:'auto',textTransform:'none',letterSpacing:0}}>
            <select value={pickSrc} onChange={e => setPickSrc(e.target.value)} style={inp}>
              <option value="dme">DME iram</option>
              <option value="klr" disabled={!hasKlr}>KLR ram</option>
            </select>
            <input value={pickAddr} onChange={e => setPickAddr(e.target.value)} placeholder="addr hex"
                   onKeyDown={e => e.key === 'Enter' && addPick()} style={{...inp,width:'60px'}} />
            <input value={pickBit} onChange={e => setPickBit(e.target.value)} placeholder="bit"
                   onKeyDown={e => e.key === 'Enter' && addPick()} style={{...inp,width:'32px'}} />
            <button style={btn} onClick={addPick}>ADD</button>
          </span>
        </div>
        {picks.length > 0 && chart(170, [
          ...picks.filter(p => p.bit == null).map(p => line(pickKey(p), PICK_COLS[picks.indexOf(p) % PICK_COLS.length])),
          ...picks.filter(p => p.bit != null).map(p => line(pickKey(p), PICK_COLS[picks.indexOf(p) % PICK_COLS.length], 'r', {type:'stepAfter'})),
        ],
          <YAxis yAxisId="l" tick={ax} stroke={C.textDim} domain={[0, 255]} width={44} tickFormatter={v => `${hx(v)}h`} />,
          <YAxis yAxisId="r" orientation="right" tick={hasBits && ax} axisLine={hasBits} stroke={C.textDim} domain={[0, 1]} ticks={[0, 1]} width={36} />)}
      </div>
    </div>
  );
}

// Short vertical tick for each IGN_OUT pulse
function IgnTick({ cx, cy, fill }) {
  if (cx == null || cy == null) return null;
  return <line x1={cx} x2={cx} y1={cy - 4} y2={cy + 4} stroke={fill} strokeWidth={1} />;
}
