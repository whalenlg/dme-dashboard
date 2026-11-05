import { NUMBERED_MAPS, DIRECT_TABLES } from "./mapDefs.js";
import { KLR_MAPS } from "./klrMapDefs.js";

// ─────────────────────────────────────────────────────────────────
//  Map / table search for the Timeline tab's memory pickers: the DME's
//  numbered maps and directly addressed tables (mapDefs.js) and the KLR's
//  maps and tables (klrMapDefs.js), by the ids the [LKUP] log lines use
//  (M<n>, T<addr>). Matches have the shape MemSearch shows:
//  { id, tag, name, desc }.
// ─────────────────────────────────────────────────────────────────

const MAX_MATCHES = 40;
const LIST = {
  dme: [
    ...NUMBERED_MAPS.map(m => ({ id: `M${m.n}`, tag: `MAP ${m.n}`, name: m.name, desc: m.purpose })),
    ...DIRECT_TABLES.map(t => ({ id: `T${t.addr.toUpperCase()}`, tag: `${t.addr}h`, name: t.name, desc: t.purpose })),
  ],
  klr: KLR_MAPS.map(m => ({ id: m.id, tag: m.addr, name: m.name, desc: m.purpose })),
};

// The entry for a map id, or a stand-in for one only the log has
export function mapEntry(src, id) {
  return LIST[src]?.find(e => e.id === id)
    ?? { id, tag: id[0] === 'M' ? `MAP ${id.slice(1)}` : `${id.slice(1)}h`, name: '', desc: '' };
}

// Maps and tables matching q (number, address, name or purpose); an empty q
// lists them all. logged: the ids the loaded log has lookups for, listed
// first, and any of them not on the workbook sheets are added.
export function searchMaps(src, q, logged = []) {
  q = q.trim().toLowerCase().replace(/^map\s*/, '');
  const have = new Set(logged);
  const list = [...(LIST[src] ?? [])];
  for (const id of logged) if (!list.some(e => e.id === id)) list.push(mapEntry(src, id));
  const hits = list.filter(e => !q
    || e.id.toLowerCase() === `m${q}` || e.id.toLowerCase() === `t${q.replace(/h$/, '')}`
    || e.name.toLowerCase().includes(q) || (q.length >= 3 && e.desc?.toLowerCase().includes(q)));
  return hits.map(e => ({ ...e, logged: have.has(e.id) }))
    .sort((a, b) => b.logged - a.logged)
    .slice(0, MAX_MATCHES);
}
