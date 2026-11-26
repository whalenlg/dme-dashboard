// ─────────────────────────────────────────────────────────────────
//  version.js — the version shown in the main window's banner
//
//  The dashboard's own build (VITE_DASH_VERSION, set in vite.config.js:
//  the lite package's release, or git describe), and the simulator's,
//  from the bridge's GET /version when it answers: {mode, version,
//  commit, describe}. In the lite package the two are the same release.
// ─────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react';

export const DASH_VERSION = import.meta.env.VITE_DASH_VERSION || 'dev';

// The bridge's /version, or null (no bridge, or one too old to have it).
// Asked again whenever `bridge` changes (e.g. LIVE turned on).
export function useSimVersion(bridge) {
  const [v, setV] = useState(null);
  useEffect(() => {
    if (!bridge) return;
    const ac = new AbortController();
    fetch(`${bridge}/version`, { signal: ac.signal })
      .then(r => r.ok ? r.json() : null)
      .then(j => setV(j && j.version ? j : null))
      .catch(() => { if (!ac.signal.aborted) setV(null); });
    return () => ac.abort();
  }, [bridge]);
  return v;
}

// The label for the banner, and its tooltip: the simulator's release when
// the bridge answers (a checkout's nearest tag, git describe, over its bare
// hash), else the dashboard's
export function versionLabel(sim) {
  const simV = sim ? (sim.mode === 'dev' && sim.describe ? sim.describe : sim.version) : null;
  const label = simV ?? DASH_VERSION;
  const tip = [
    sim ? `Simulator ${simV}${sim.mode === 'lite' ? ' (lite package)' : ' (developer checkout)'}${sim.commit ? `\ncommit ${sim.commit}` : ''}`
        : 'Simulator: no bridge answered',
    `Dashboard ${DASH_VERSION}`,
  ].join('\n');
  return { label, tip };
}
