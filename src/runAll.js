import { useState, useEffect, useCallback, useRef } from "react";

// GET <bridge>/runall for the RUN REGRESSIONS panel (RunAllPanel.jsx) and the
// header button
const POLL_OPEN_MS = 2000;
const POLL_BG_MS = 10000;

// The run's state from the bridge, polled: often while the panel is open,
// now and then while it's closed (so the header button shows a running
// run's %), and not at all when the bridge can't be reached and no run
// was seen (no console noise on a page used only for logs)
export function useRunAll(url, open) {
  const [info, setInfo] = useState(null);     // GET /runall
  const [err, setErr] = useState(null);
  const seen = useRef(false);
  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`${url}/runall`);
      if (r.status === 404) throw new Error('this bridge has no RUN REGRESSIONS (update 944turbo_dme_klr)');
      if (!r.ok) throw new Error(`bridge answered ${r.status}`);
      const j = await r.json();
      setInfo(j); setErr(null);
      if (j.run) seen.current = true;
    } catch (e) {
      setErr(e.message === 'Failed to fetch' || e.name === 'TypeError'
        ? `no bridge at ${url}: start it (dme_klr/live/bridge.mjs, or run_lite.sh in the lite package)` : e.message);
    }
  }, [url]);
  const running = !!info?.run?.running;
  useEffect(() => {
    if (!url) return;
    if (!open && !seen.current) return;
    refresh();
    const id = setInterval(refresh, open || running ? (open ? POLL_OPEN_MS : POLL_BG_MS) : POLL_BG_MS * 3);
    return () => clearInterval(id);
  }, [url, open, running, refresh]);
  return { info, err, refresh };
}

// ── Regression hosts (the REGRESSION HOSTS box in RUN REGRESSIONS) ──
export function useRegressHosts(url, open) {
  const [hosts, setHosts] = useState(null);   // {local, hosts}
  const [err, setErr] = useState(null);
  const load = useCallback(async (probe) => {
    try {
      const r = await fetch(`${url}/runall/hosts${probe ? '?probe=1' : ''}`);
      if (!r.ok) throw new Error(r.status === 404 ? 'this bridge has no regression hosts (update 944turbo_dme_klr)' : `bridge answered ${r.status}`);
      setHosts(await r.json()); setErr(null);
    } catch (e) { setErr(e.message); }
  }, [url]);
  useEffect(() => {
    if (!open || !url) return;
    load(false);
    const id = setInterval(() => load(false), 15000);
    return () => clearInterval(id);
  }, [open, url, load]);
  return { hosts, err, load, setHosts };
}

// The threads the run can count on: the enabled hosts that answered with
// the same software
export const usableThreads = h => (h?.hosts ?? []).filter(x => x.enabled && x.status?.ok).reduce((a, x) => a + x.threads, 0);

// The log folder of a ROM pair, $DMEKLR_TMP/dme_klr/<folder>, named as the
// bridge (dme_klr/live/logdirs.mjs) and paths.sh name it: 89 (the default
// 1989 pair), 86 (run86.sh), carpokes (run_carpokes.sh), any other pair
// the DME image's name without its extension
const NAMED_ROM_FOLDERS = { '89DME_951pin+89KLR_951': '89', '28PIN_86DME+86KLR_951': '86',
                            '28PIN_DME_PERFORMANCE+87KLR_951': 'carpokes' };
const romStem = f => String(f).replace(/\\/g, '/').split('/').pop().replace(/\.[^.]*$/, '');
export function romFolder(dme, klr) {
  const key = `${romStem(dme || '89DME_951pin.mem')}+${romStem(klr || '89KLR_951.mem')}`;
  return NAMED_ROM_FOLDERS[key] ?? romStem(dme || '89DME_951pin.mem').replace(/[^A-Za-z0-9_.+-]/g, '_');
}
