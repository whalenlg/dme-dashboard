// Shared by the KLR RPM MAPS tab and the Timeline tab's MEMORY vs RPM chart.

// Engine speed at time t from DME rows [{ t, rpm }] (time sorted), linear
// between rows no more than 500 ms apart, else null
export function rpmAtFn(rows) {
  let j = 0;
  return t => {
    if (!rows?.length) return null;
    if (j >= rows.length || rows[j].t > t) j = 0;
    while (j + 1 < rows.length && rows[j + 1].t <= t) j++;
    const a = rows[j], b = rows[j + 1];
    if (a.t > t) return null;
    if (!b) return t - a.t <= 500 ? a.rpm : null;
    if (b.t - a.t > 500) return t - a.t <= 500 ? a.rpm : null;
    return a.rpm + (b.rpm - a.rpm) * (t - a.t) / (b.t - a.t);
  };
}
