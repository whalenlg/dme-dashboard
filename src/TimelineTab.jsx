import { useState, useMemo, memo, useRef } from "react";
import {
  ComposedChart, Line, Scatter, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
  useXAxisScale, usePlotArea
} from "recharts";
import { thin, syncNearest, inRange } from "./thin.js";
import { CursorLine } from "./cursor.jsx";
import { useZoom, zoomHandlers, ZoomBox, DragArea, ZoomBar } from "./zoom.jsx";
import { IRAM_MAP, KLR_KNOWN, BIT_LABELS, BIT_DESC, prpmToRpm, ntcLinToC, battRawToV } from "./memDefs.js";

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

// Same conversion as prpmToRpm in App.jsx: prpm=21 @ 840 RPM → K=17640,
// valid for prpm >= 3 once EngineSync (iram[21h].0) has been seen. The bit
// is latched here because real logs show it clearing again after sync
// (21h goes 0x13 → 0x70 at ~1.6 s in warm_idle_5s) while prpm stays valid.
const fwRpm = (ir, synced) => synced && ir[0x37] >= 3 ? Math.round(17640 / ir[0x37]) : null;
const hx = v => v.toString(16).toUpperCase().padStart(2, '0');
const pickKey = p => `${p.src}_${hx(p.addr)}${p.bit != null ? `_${p.bit}` : ''}`;
// Disassembly name for a byte (or a DME bit-addressable bit), '' if none
const memName = (src, addr, bit) => {
  if (src === 'klr') return KLR_KNOWN[addr]?.n ?? '';
  if (bit != null && addr >= 0x20 && addr <= 0x2F) {
    const b = BIT_LABELS[(addr - 0x20) * 8 + bit];
    if (b) return b;
  }
  const n = IRAM_MAP.find(e => e.a === addr)?.n ?? '';
  return /^r[0-9A-F]{2}$/.test(n) ? '' : n;   // r00..r0F are placeholders
};
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
           note: '17640 / raw: the DME period byte prpm (iram 37h); blank below 3' },
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

// Everything the picker search can offer for one CPU: named bytes, and for
// the DME the named bits of the bit-addressable area 20h–2Fh
const SEARCH_LIST = {
  dme: [
    ...IRAM_MAP.filter(e => !/^r[0-9A-F]{2}$/.test(e.n)).map(e => ({ addr: e.a, name: e.n, desc: e.d })),
    ...Object.entries(BIT_LABELS).filter(([, n]) => n).map(([b, n]) => ({
      addr: 0x20 + (b >> 3), bit: b & 7, name: n, desc: BIT_DESC[b] ? `bit ${hx(+b)}h: ${BIT_DESC[b]}` : `bit ${hx(+b)}h` })),
  ].sort((x, y) => x.addr - y.addr || (x.bit ?? -1) - (y.bit ?? -1)),
  klr: Object.entries(KLR_KNOWN).map(([a, e]) => ({ addr: +a, name: e.n, desc: e.d })),
};
const MAX_MATCHES = 14;

function searchMem(src, q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const list = SEARCH_LIST[src] ?? [];
  // "7d", "7dh", "0x7d", "21h.0", "21.0" → address (and bit) match
  const m = /^(?:0x)?([0-9a-f]{1,2})h?(?:\.([0-7]))?$/.exec(q);
  const addr = m ? parseInt(m[1], 16) : null, bit = m?.[2] != null ? +m[2] : null;
  const out = [];
  if (addr != null && addr <= 0x7F) {
    for (const e of list) if (e.addr === addr && (bit == null || e.bit === bit)) out.push(e);
    if (!out.some(e => e.bit === (bit ?? undefined)))
      out.unshift({ addr, ...(bit != null ? { bit } : {}), name: memName(src, addr, bit) || '(unnamed)', desc: '' });
  }
  const byName = [], byDesc = [];
  for (const e of list) {
    if (out.includes(e)) continue;
    if (e.name.toLowerCase().includes(q)) byName.push(e);
    else if (q.length >= 3 && e.desc?.toLowerCase().includes(q)) byDesc.push(e);
  }
  return [...out, ...byName, ...byDesc].slice(0, MAX_MATCHES);
}

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

// Memoized: live mode re-renders the page on every sim tick
// range/setRange: the zoom shared with the other chart tabs ([t0, t1] or null = whole log)
const TimelineTab = memo(function TimelineTab({ chartData, dmeSnapshots, dmePhases, klrData, onSeek, range, setRange }) {
  const [showDmeMk, setShowDmeMk] = useState(true);
  const [showKlrMk, setShowKlrMk] = useState(true);
  const [hidden, setHidden] = useState({});     // series key → true when hidden
  const [picks, setPicks]   = useState(loadPicks);
  const [pickSrc, setPickSrc]   = useState('dme');
  const [pickAddr, setPickAddr] = useState('');   // search text: hex address or name
  const [pickBit, setPickBit]   = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [hl, setHl] = useState(0);                // highlighted search match
  const searchRef = useRef(null);
  const matches = useMemo(() => searchMem(pickSrc, pickAddr), [pickSrc, pickAddr]);

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

  const addPickAt = (addr, bit) => {
    if (isNaN(addr) || addr < 0 || addr > 0x7F || (bit != null && (isNaN(bit) || bit < 0 || bit > 7))) return;
    const p = { src: pickSrc, addr, ...(bit != null ? { bit } : { unit: defaultUnit(pickSrc, addr) }) };
    setPickAddr(''); setPickBit(''); setSearchOpen(false); setHl(0);
    if (picks.some(q => pickKey(q) === pickKey(p))) return;
    const next = [...picks, p];
    setPicks(next); savePicks(next);
  };
  // ADD / Enter: the highlighted search match, else the text as a hex address
  const addPick = () => {
    const bitIn = pickBit === '' ? null : parseInt(pickBit, 10);
    const m = searchOpen ? matches[hl] : null;
    if (m) return addPickAt(m.addr, bitIn ?? m.bit ?? null);
    addPickAt(parseInt(pickAddr.replace(/^0x/i, '').replace(/h$/i, ''), 16), bitIn);
  };
  const removePick = k => { const next = picks.filter(p => pickKey(p) !== k); setPicks(next); savePicks(next); };
  const setPickUnit = (k, unit) => {
    const next = picks.map(p => pickKey(p) === k ? { ...p, unit } : p);
    setPicks(next); savePicks(next);
  };
  const onSearchKey = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSearchOpen(true); setHl(h => Math.min(h + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHl(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Escape') setSearchOpen(false);
    else if (e.key === 'Enter') addPick();
  };

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
        <div style={title}>MEMORY PICKER
          {picks.map((p, i) => (
            <span key={pickKey(p)} style={{display:'inline-flex',gap:'4px',alignItems:'center'}}>
              {chip(pickKey(p), pickLabel(p), PICK_COLS[i % PICK_COLS.length])}
              {p.bit == null &&
                <select value={p.unit ?? 'raw'} onChange={e => setPickUnit(pickKey(p), e.target.value)}
                        title={`Tooltip unit${UNITS[p.unit]?.note ? ` — ${UNITS[p.unit].note}` : ''}`}
                        style={{...inp,padding:'1px 2px',fontSize:'9px',textTransform:'none',letterSpacing:0}}>
                  {Object.entries(UNITS).map(([k, u]) => <option key={k} value={k}>{u.label}</option>)}
                </select>}
              <span onClick={() => removePick(pickKey(p))} style={{cursor:'pointer',color:'#886666'}} title="Remove">✕</span>
            </span>
          ))}
          <span style={{display:'inline-flex',gap:'4px',alignItems:'center',marginLeft:'auto',textTransform:'none',letterSpacing:0}}>
            <select value={pickSrc} onChange={e => { setPickSrc(e.target.value); setHl(0); }} style={inp}>
              <option value="dme">DME iram</option>
              <option value="klr" disabled={!hasKlr}>KLR ram</option>
            </select>
            <span style={{position:'relative'}}>
              <input ref={searchRef} value={pickAddr} placeholder="search name or hex addr"
                     onChange={e => { setPickAddr(e.target.value); setSearchOpen(true); setHl(0); }}
                     onFocus={() => setSearchOpen(true)}
                     onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
                     onKeyDown={onSearchKey} style={{...inp,width:'170px'}} />
              {searchOpen && matches.length > 0 && (
                <div style={{position:'absolute',top:'100%',right:0,zIndex:20,minWidth:'320px',maxWidth:'460px',
                             background:'#030803',border:`1px solid ${C.border}`,boxShadow:'0 4px 12px #000a'}}>
                  {matches.map((m, i) => (
                    <div key={`${m.addr}_${m.bit ?? ''}`}
                         onMouseDown={e => { e.preventDefault(); addPickAt(m.addr, m.bit ?? null); }}
                         onMouseEnter={() => setHl(i)}
                         title={m.desc}
                         style={{padding:'3px 6px',cursor:'pointer',fontSize:'10px',display:'flex',gap:'8px',
                                 background:i === hl ? '#0d2e0d' : 'transparent'}}>
                      <span style={{color:C.blue,minWidth:'42px'}}>{hx(m.addr)}h{m.bit != null ? `.${m.bit}` : ''}</span>
                      <span style={{color:C.textBright}}>{m.name}</span>
                      <span style={{color:C.textDim,opacity:0.7,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.desc}</span>
                    </div>
                  ))}
                </div>
              )}
            </span>
            <input value={pickBit} onChange={e => setPickBit(e.target.value)} placeholder="bit"
                   onKeyDown={e => e.key === 'Enter' && addPick()} style={{...inp,width:'32px'}} />
            <button style={btn} onClick={addPick}>ADD</button>
          </span>
        </div>
        {picks.length > 0 && chart(shown.picks, 170, [
          ...picks.filter(p => p.bit == null).map(p => line(pickKey(p), PICK_COLS[picks.indexOf(p) % PICK_COLS.length])),
          ...picks.filter(p => p.bit != null).map(p => line(pickKey(p), PICK_COLS[picks.indexOf(p) % PICK_COLS.length], 'r', {type:'stepAfter'})),
        ],
          <YAxis yAxisId="l" tick={ax} stroke={C.textDim} domain={[0, 255]} width={44} tickFormatter={v => `${hx(v)}h`} />,
          <YAxis yAxisId="r" orientation="right" tick={hasBits && ax} axisLine={hasBits} stroke={C.textDim} domain={[0, 1]} ticks={[0, 1]} width={36} />)}
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
