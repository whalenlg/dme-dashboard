import { useState } from "react";

// ─────────────────────────────────────────────────────────────────
//  ROM VARIANTS (in RUN REGRESSIONS): two or more ROM pairs' dashboard
//  tests side by side, from the logs each pair's runs left in its own
//  folder ($DMEKLR_TMP/dme_klr/<rom>: 89, 86, carpokes, <DME image>).
//    GET <url>/runall/romdiff?roms=a,b[,..]&sim=verilator|iverilog|both[&all=1]
//  (dme_klr/live/runall.mjs → dme_klr/rom_variant_diff.py, developer
//  install). For each test that ran on more than one pair: its verdicts,
//  and the DME / KLR [STATUS] fields whose settled mean (second half of
//  the run) differs from the first pair's, largest difference first.
//  A test's OPEN links load that pair's .dash.log in a new tab.
// ─────────────────────────────────────────────────────────────────

const C = {
  border:'#0d2e0d', border2:'#1a3a1a', text:'#00e060', textDim:'#ccddcc', textBright:'#00ff80',
  amber:'#ffaa00', red:'#ff4444', blue:'#44aaff', grey:'#557755',
};
const VERDICT_COL = { PASS:C.textBright, WARN:C.amber, FAIL:C.red, MISSING:C.grey, 'NO VERDICT':C.grey };
const SIDE_DIR = { verilator: 'v_dash_logs', iverilog: 'dash_logs' };
const fmtV = (v, hex) => (v == null ? '—' : hex ? `0x${Number(v).toString(16).padStart(2, '0')}` : String(v));

export default function RomVariants({ url, folders, pickFolder, active, btn, inp }) {
  const [pick, setPick] = useState(() => {
    const two = [pickFolder, ...folders.filter(f => f !== pickFolder)].slice(0, 2);
    return new Set(two);
  });
  const [sim, setSim] = useState('both');
  const [all, setAll] = useState(false);
  const [res, setRes] = useState(null);       // {loading} | GET /runall/romdiff | {error}
  const [openT, setOpenT] = useState({});     // `${sim}/${test}` → expanded
  // the picked ones in the order the folders are listed: the first is the reference
  const order = folders.filter(f => pick.has(f));

  const load = async (o = {}) => {
    const roms = o.order ?? order;
    if (roms.length < 2) return;
    setRes(r => ({ ...(r ?? {}), loading: true }));
    try {
      const q = `roms=${roms.map(encodeURIComponent).join(',')}&sim=${o.sim ?? sim}${(o.all ?? all) ? '&all=1' : ''}`;
      const r = await fetch(`${url}/runall/romdiff?${q}`);
      if (!r.ok) {
        const msg = await r.text();
        return setRes({ error: r.status === 404 && !msg.includes('developer')
          ? 'this bridge has no ROM VARIANTS (update 944turbo_dme_klr and restart the bridge)' : `${r.status} ${msg}` });
      }
      const j = await r.json();
      setRes(j.error ? { error: j.error } : j);
    } catch (e) { setRes({ error: e.message }); }
  };
  const toggle = f => setPick(p => { const n = new Set(p); n.has(f) ? n.delete(f) : n.add(f); return n; });
  const logHref = (rom, side, test) =>
    `${window.location.pathname}?log=${encodeURIComponent(`${url}/logs/${encodeURIComponent(rom)}/${SIDE_DIR[side]}/${test}.dash.log`)}`;

  return (
    <div style={{marginTop:'10px',borderTop:`1px solid ${C.border}`,paddingTop:'8px'}}>
      <div style={{display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap',fontSize:'10px',color:C.textDim}}>
        <span style={{color:C.textBright,letterSpacing:'.15em',fontSize:'9px'}}>ROM VARIANTS</span>
        <span title="Each ROM pair's runs are in its own folder, tmp/dme_klr/<folder>; the first one ticked is the reference the others' values are compared with">
          ROM folders:</span>
        {folders.map(f => <label key={f} style={{display:'flex',alignItems:'center',gap:'4px',cursor:'pointer'}}>
          <input type="checkbox" checked={pick.has(f)} onChange={() => toggle(f)} />{f}{order[0] === f && order.length > 1 ? ' (ref)' : ''}</label>)}
        {folders.length < 2 && <span style={{color:C.amber}}>only one ROM folder has logs: run the tests on another ROM pair first (pick it above and START RUN)</span>}
        <label style={{display:'flex',alignItems:'center',gap:'5px'}}>logs
          <select value={sim} style={{...inp,fontSize:'10px',padding:'1px 4px'}}
            onChange={e => { setSim(e.target.value); if (res) load({ sim: e.target.value }); }}>
            <option value="both">Verilator + iverilog</option>
            <option value="verilator">Verilator</option>
            <option value="iverilog">iverilog</option>
          </select></label>
        <label style={{display:'flex',alignItems:'center',gap:'4px',cursor:'pointer'}}
          title="Also list the tests whose verdicts and values are the same on every picked pair">
          <input type="checkbox" checked={all} onChange={e => { setAll(e.target.checked); if (res) load({ all: e.target.checked }); }} />matching tests too</label>
        {active && <span style={{color:C.amber}}>a run is going: tests not done yet show their older logs or none</span>}
        <button style={{...btn('s', order.length < 2 || res?.loading),marginLeft:'auto',padding:'2px 8px',fontSize:'9px'}}
          disabled={order.length < 2 || !!res?.loading} onClick={() => load()}>{res && !res.loading ? 'REFRESH' : 'COMPARE'}</button>
      </div>
      {order.length < 2 && folders.length >= 2 && <div style={{color:C.amber,fontSize:'10px',marginTop:'4px'}}>tick two or more ROM folders</div>}
      {res?.loading && <div style={{color:C.textDim,fontSize:'10px',marginTop:'6px'}}>running rom_variant_diff.py…</div>}
      {res?.error && <div style={{color:C.red,fontSize:'10px',marginTop:'6px'}}>{res.error}</div>}
      {res?.sides && !res.loading && res.sides.map(sd => {
        const roms = sd.roms;
        return (
          <div key={sd.sim} style={{marginTop:'8px'}}>
            <div style={{color:C.textBright,fontSize:'10px',letterSpacing:'.1em'}}>
              {sd.sim === 'verilator' ? 'VERILATOR' : 'IVERILOG'}
              <span style={{color:C.textDim,letterSpacing:0,marginLeft:'8px'}}>
                {roms.length < 2 ? 'fewer than two of the picked folders have these logs'
                  : `${sd.differing} of ${sd.total} test(s) differ in verdict or values`
                    + ` · values against ${roms[0]} · as of ${new Date(res.at).toLocaleTimeString()}`}
                {sd.missing?.length > 0 && <span style={{color:C.amber}}> · no logs in {sd.missing.join(', ')}</span>}
              </span>
            </div>
            {roms.length >= 2 && <div style={{color:C.grey,fontSize:'10px',margin:'2px 0 4px'}}>
              {roms.map(r => `${r}: ${sd.images?.[r]?.DME ?? '?'} + ${sd.images?.[r]?.KLR ?? '?'}`).join(' · ')}</div>}
            {roms.length >= 2 && sd.tests.length === 0 &&
              <div style={{color:C.textDim,fontSize:'10px'}}>no test differs{all ? ', and none ran on two of them' : ''}</div>}
            {roms.length >= 2 && sd.tests.length > 0 && (
              <div style={{fontSize:'10px'}}>
                <div style={{display:'flex',gap:'8px',color:C.grey,borderBottom:`1px solid ${C.border}`,padding:'2px 0'}}>
                  <span style={{width:'230px'}}>TEST</span>
                  {roms.map(r => <span key={r} style={{width:'90px'}}>{r}</span>)}
                  <span>VALUES</span>
                </div>
                {sd.tests.map(t => {
                  const k = `${sd.sim}/${t.test}`;
                  const nv = t.values_differ;
                  return (
                    <div key={k} style={{borderBottom:`1px solid ${C.border}`}}>
                      <div style={{display:'flex',gap:'8px',alignItems:'center',padding:'2px 0',cursor:'pointer'}}
                           onClick={() => setOpenT(o => ({ ...o, [k]: !o[k] }))}>
                        <span style={{width:'230px',color:C.textBright,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                          {openT[k] ? '▾' : '▸'} {t.test}</span>
                        {roms.map(r => { const v = t.verdicts[r]?.verdict ?? 'MISSING';
                          return <span key={r} title={t.verdicts[r]?.detail || undefined}
                                       style={{width:'90px',color:VERDICT_COL[v] ?? C.textDim}}>{v}</span>; })}
                        <span style={{color:nv ? C.amber : C.textDim}}>
                          {nv ? `${nv} field${nv === 1 ? '' : 's'} differ` : 'same'}
                          {t.verdict_differs && <span style={{color:C.red}}> · verdict differs</span>}</span>
                      </div>
                      {openT[k] && <div style={{padding:'2px 0 6px 18px',color:C.textDim}}>
                        {roms.map(r => t.verdicts[r] && <div key={r} style={{display:'flex',gap:'8px'}}>
                          <span style={{width:'80px'}}>{r}</span>
                          <span style={{width:'50px',color:VERDICT_COL[t.verdicts[r].verdict] ?? C.textDim}}>{t.verdicts[r].verdict}</span>
                          {t.ran?.includes(r) && t.verdicts[r].verdict !== 'MISSING' &&
                            <a href={logHref(r, sd.sim, t.test)} target="_blank" rel="noreferrer"
                               style={{color:C.blue}} title="This pair's .dash.log in a new dashboard tab">OPEN</a>}
                          <span style={{flex:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}
                                title={t.verdicts[r].detail}>{t.verdicts[r].detail}</span>
                        </div>)}
                        {Object.entries(t.values ?? {}).map(([r, d]) => ['DME', 'KLR'].map(ecu => d[ecu]?.count > 0 && (
                          <div key={`${r}-${ecu}`} style={{marginTop:'4px'}}>
                            <div style={{color:C.textBright}}>{ecu} · {r} against {t.ref}: {d[ecu].count} field{d[ecu].count === 1 ? '' : 's'} differ
                              {d[ecu].count > d[ecu].fields.length ? ` (the ${d[ecu].fields.length} largest)` : ''}</div>
                            <table style={{borderCollapse:'collapse',fontSize:'10px'}}><tbody>
                              <tr style={{color:C.grey}}><td style={{paddingRight:'14px'}}>field</td>
                                <td style={{paddingRight:'14px',textAlign:'right'}}>{t.ref}</td><td style={{paddingRight:'14px',textAlign:'right'}}>{r}</td>
                                <td style={{paddingRight:'14px'}}>last values</td><td>difference</td></tr>
                              {d[ecu].fields.map(f => <tr key={f.field}>
                                <td style={{paddingRight:'14px',color:C.text}}>{f.field}</td>
                                <td style={{paddingRight:'14px',textAlign:'right'}}>{fmtV(f.ref, f.hex)}</td>
                                <td style={{paddingRight:'14px',textAlign:'right'}}>{fmtV(f.val, f.hex)}</td>
                                <td style={{paddingRight:'14px'}}>{fmtV(f.ref_last, f.hex)} → {fmtV(f.last, f.hex)}</td>
                                <td style={{color:C.amber}}>{f.note ?? `${Math.round(f.rel * 100)} %`}</td>
                              </tr>)}
                            </tbody></table>
                          </div>)))}
                        {t.values && Object.keys(t.values).length === 0 && <div>no .dash.log to compare values with</div>}
                      </div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {res?.sides && <div style={{color:C.grey,fontSize:'10px',marginTop:'6px'}}>
        Values: each [STATUS] field's mean over the second half of the run (raw counts, as the log has them; DME rpm in RPM),
        listed when it differs by 2 % and more than one count; flag bytes by the value they hold most of the run.
        Different ROMs are expected to differ: this shows where and by how much. The same from the command line:
        dme_klr/rom_variant_diff.py, or compare_rom_variants.sh to run the variants first.</div>}
    </div>
  );
}
