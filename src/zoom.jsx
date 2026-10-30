import { useState, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { useXAxisScale, usePlotArea } from "recharts";

// ─────────────────────────────────────────────────────────────────
//  CHART ZOOM
//  The same time-axis zoom on every chart:
//    drag across a chart          → zoom to that span
//    ctrl/⌘ + wheel (or pinch)    → zoom in/out around the pointer
//    shift + wheel                → pan
//    double-click, RESET ZOOM     → whole log again
//    click (no drag)              → onClick(t), e.g. move the scrubber
//  Charts that share a range (one setRange) zoom together. The drag
//  selection lives in a small store that only <DragArea> subscribes
//  to, so dragging redraws the selection boxes, not the charts.
// ─────────────────────────────────────────────────────────────────

function makeZoom() {
  let drag = null;
  const subs = new Set();
  const cur = { range: null, setRange: () => {}, full: null, onClick: null };
  const z = {
    cur,
    hoverT: null,
    getDrag: () => drag,
    subscribe: f => { subs.add(f); return () => subs.delete(f); },
    setDrag: d => { drag = d; subs.forEach(f => f()); },
    // Recharts mouse handlers: spread onto the chart (see zoomHandlers)
    onMouseDown: e => { if (e?.activeLabel != null) z.setDrag({ a: +e.activeLabel, b: +e.activeLabel }); },
    onMouseMove: e => {
      if (e?.activeLabel == null) return;
      z.hoverT = +e.activeLabel;
      if (drag) z.setDrag({ ...drag, b: z.hoverT });
    },
    onMouseUp: () => {
      const d = drag;
      if (!d) return;
      z.setDrag(null);
      const lo = Math.min(d.a, d.b), hi = Math.max(d.a, d.b);
      if (hi > lo) cur.setRange([lo, hi]);
      else cur.onClick?.(lo);
    },
    // Overshooting the plot edge while dragging still zooms to the edge
    onMouseLeave: () => { z.hoverT = null; if (drag && drag.a !== drag.b) z.onMouseUp(); else z.setDrag(null); },
    // Scale the visible span by f around time `at` (the middle by default)
    zoomBy: (f, at) => {
      const full = cur.full;
      if (!full || !(full[1] > full[0])) return;
      const [lo, hi] = cur.range ?? full;
      const c = at ?? (lo + hi) / 2;
      let a = c - (c - lo) * f, b = c + (hi - c) * f;
      if (b - a >= full[1] - full[0]) return cur.setRange(null);
      if (b - a < 0.01) return;
      if (a < full[0]) { b += full[0] - a; a = full[0]; }
      if (b > full[1]) { a -= b - full[1]; b = full[1]; }
      cur.setRange(roundRange(a, b));
    },
    // Shift the visible span by `frac` of its width
    pan: frac => {
      const full = cur.full;
      if (!cur.range || !full) return;
      const [lo, hi] = cur.range, w = hi - lo;
      const a = Math.min(Math.max(lo + w * frac, full[0]), full[1] - w);
      cur.setRange(roundRange(a, a + w));
    },
    reset: () => cur.setRange(null),
  };
  return z;
}

// Wheel steps land on odd fractions; keep about 3 significant digits of span
function roundRange(a, b) {
  const step = 10 ** Math.floor(Math.log10((b - a) / 100));
  const r = v => +(Math.round(v / step) * step).toFixed(Math.max(0, -Math.log10(step)));
  return [r(a), r(b)];
}

// range/setRange: the [t0, t1] (null = everything) this group of charts
// shows. full: [first, last] time of the data. onClick: a click with no drag.
export function useZoom(range, setRange, full, onClick) {
  const [z] = useState(makeZoom);
  useLayoutEffect(() => { Object.assign(z.cur, { range, setRange, full, onClick }); });
  return z;
}

export const zoomHandlers = z => ({
  onMouseDown: z.onMouseDown, onMouseMove: z.onMouseMove,
  onMouseUp: z.onMouseUp, onMouseLeave: z.onMouseLeave,
});

// Wraps a chart: wheel zoom/pan and double-click reset
export function ZoomBox({ zoom, children, style }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = e => {
      const d = e.deltaY || e.deltaX;
      if (!d) return;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoom.zoomBy(Math.exp(Math.max(-100, Math.min(100, d)) * 0.003), zoom.hoverT);
      } else if (e.shiftKey && zoom.cur.range) {
        e.preventDefault();
        zoom.pan(Math.sign(d) * 0.1);
      }
    };
    // Non-passive, or preventDefault can't stop the page zooming/scrolling
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom]);
  return <div ref={ref} style={{ userSelect: 'none', ...style }} onDoubleClick={zoom.reset}>{children}</div>;
}

// The drag selection, drawn inside a chart
export function DragArea({ zoom, fill = '#00ff80' }) {
  const d = useSyncExternalStore(zoom.subscribe, zoom.getDrag);
  const x = useXAxisScale();
  const area = usePlotArea();
  if (!d || d.a === d.b || !x || !area) return null;
  const clamp = v => Math.min(Math.max(v, area.x), area.x + area.width);
  const x1 = clamp(x(Math.min(d.a, d.b))), x2 = clamp(x(Math.max(d.a, d.b)));
  if (Number.isNaN(x1) || Number.isNaN(x2)) return null;
  return <rect x={x1} y={area.y} width={x2 - x1} height={area.height}
               fill={fill} fillOpacity={0.12} pointerEvents="none" />;
}

const fmtT = v => +(+v).toFixed(2);

// Range readout, zoom out / reset buttons and the gesture hint
export function ZoomBar({ zoom, range, full, btn, color = '#00ff80', dim = '#ccddcc', unit = 'ms', hint = true }) {
  const [t0, t1] = range ?? full ?? [];
  const has = full && full[1] > full[0];
  return (
    <span style={{ display: 'inline-flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
      {has && <span style={{ color, fontSize: '11px' }}>
        {range ? 'ZOOM' : 'ALL'} {fmtT(t0)}–{fmtT(t1)} {unit}
      </span>}
      {range && <button style={btn} onClick={() => zoom.zoomBy(2)} title="Zoom out ×2">ZOOM OUT</button>}
      {range && <button style={btn} onClick={zoom.reset}>RESET ZOOM</button>}
      {hint && <span style={{ color: dim, fontSize: '9px' }}>
        drag to zoom · ctrl+wheel zoom · shift+wheel pan · double-click reset
      </span>}
    </span>
  );
}
