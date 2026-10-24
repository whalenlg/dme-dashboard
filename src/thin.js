// ─────────────────────────────────────────────────────────────────
//  CHART DECIMATION
//  Recharts draws (and React diffs) every point it is given, so long
//  logs and long live runs are thinned to about `max` rows before they
//  reach a chart. Rows are split into time-ordered buckets and each
//  bucket keeps its first row plus the rows holding the min and max of
//  every key, so spikes, pulses and step edges survive the thinning.
// ─────────────────────────────────────────────────────────────────

export const MAX_CHART_POINTS = 1000;

export function thin(rows, keys, max = MAX_CHART_POINTS) {
  if (!rows || rows.length <= max) return rows;
  const ks = Array.isArray(keys) ? keys : [keys];
  const per = 1 + 2 * ks.length;                       // rows kept per bucket, at most
  const size = Math.ceil(rows.length * per / max);
  const out = [];
  for (let b = 0; b < rows.length; b += size) {
    const end = Math.min(rows.length, b + size);
    const keep = new Set([b]);
    for (const k of ks) {
      let lo = -1, hi = -1;
      for (let i = b; i < end; i++) {
        const v = rows[i][k];
        if (v == null || Number.isNaN(v)) continue;
        if (lo < 0 || v < rows[lo][k]) lo = i;
        if (hi < 0 || v > rows[hi][k]) hi = i;
      }
      if (lo >= 0) keep.add(lo);
      if (hi >= 0) keep.add(hi);
    }
    for (const i of [...keep].sort((x, y) => x - y)) out.push(rows[i]);
  }
  if (out[out.length - 1] !== rows[rows.length - 1]) out.push(rows[rows.length - 1]);
  return out;
}

// Math.min/max(...arr) throw RangeError past ~100k arguments
export function extent(vals) {
  let lo = Infinity, hi = -Infinity;
  for (const v of vals) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return [lo, hi];
}

// Recharts syncMethod for synced charts that were thinned differently, so
// the same time isn't at the same index (or present at all) in each: every
// chart shows its tooltip at its point nearest the hovered time.
export function syncNearest(ticks, { activeLabel }) {
  const t = +activeLabel;
  if (!ticks.length || Number.isNaN(t)) return 0;
  let lo = 0, hi = ticks.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (ticks[mid].value < t) lo = mid + 1; else hi = mid; }
  return lo > 0 && t - ticks[lo - 1].value < ticks[lo].value - t ? lo - 1 : lo;
}
