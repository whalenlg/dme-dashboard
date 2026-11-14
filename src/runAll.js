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

