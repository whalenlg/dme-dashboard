import { useEffect, useRef, useState } from "react";

// ─────────────────────────────────────────────────────────────────
//  REGION/ALT/CAT (in RUN REGRESSIONS): the "Region, altitude and cat"
//  tests against their baselines, one table per ROM folder.
//    GET <url>/runall/regioncat?roms=a,b[,..]&sim=verilator|iverilog|both
//  (dme_klr/live/runall.mjs → dme_klr/region_alt_cat_report.py,
//  developer install). The ramps (cl_ramp_to_3000/6000_NO_CAT, _ROW,
//  _ROW_HIGH_ALT, _PIN28_OPEN) against cl_ramp_to_3000 / cl_ramp_to_6000
//  (cat, US, below 1000 m): the settled change in fuel %, timing °, rpm
//  and load, with the fuel and timing ranges the validator checks for
//  that DME image. The idle tests against warm_idle_5s, reported only.
//  Under the tables, a chart of each test's fuel and timing change per
//  ROM folder with the expected range as a band.
// ─────────────────────────────────────────────────────────────────

const C = {
  border:'#0d2e0d', border2:'#1a3a1a', text:'#00e060', textDim:'#ccddcc', textBright:'#00ff80',
  amber:'#ffaa00', red:'#ff4444', blue:'#44aaff', grey:'#557755', surface:'#060e06',
};
const VERDICT_COL = { PASS:C.textBright, WARN:C.amber, FAIL:C.red };
const CHECK = { pass: { s: '✓', c: C.textBright }, fail: { s: '✗', c: C.red } };
// ROM folder colours (validated, dark surface #060e06, all pairs) and a
// marker shape each, so a ROM is never told apart by colour alone
const ROM_COL = ['#338ced', '#e76624', '#00a888', '#d28e05', '#e24d8b', '#9887ef'];
const SHAPES = ['circle', 'square', 'triangle', 'diamond', 'circle', 'square'];
const FAMILY = { 3000: 'cl_ramp_to_3000', 6000: 'cl_ramp_to_6000', idle: 'idle (vs warm_idle_5s)' };
const SIDE_DIR = { verilator: 'v_dash_logs', iverilog: 'dash_logs' };

const f1 = (v, d = 1) => {
  if (v == null || Number.isNaN(v)) return '—';
  const s = v.toFixed(d);
  return /^-0(\.0*)?$/.test(s) ? s.slice(1).replace(/^/, '+') : `${v >= 0 ? '+' : ''}${s}`;
};
const rng = r => (r ? `[${f1(r[0], r[0] % 1 ? 1 : 0)}, ${f1(r[1], r[1] % 1 ? 1 : 0)}]` : '');

function Marker({ shape, x, y, col, r = 4 }) {
  const ring = { fill: col, stroke: C.surface, strokeWidth: 2 };
  if (shape === 'square') return <rect x={x - r} y={y - r} width={2 * r} height={2 * r} {...ring} />;
  if (shape === 'triangle') return <path d={`M${x},${y - r - 1} L${x + r + 1},${y + r} L${x - r - 1},${y + r} Z`} {...ring} />;
  if (shape === 'diamond') return <path d={`M${x},${y - r - 1} L${x + r + 1},${y} L${x},${y + r + 1} L${x - r - 1},${y} Z`} {...ring} />;
  return <circle cx={x} cy={y} r={r} {...ring} />;
}

// One panel: a row per test, a lane per ROM folder: its expected range as a
// band and its change as a marker
function DeltaChart({ title, unit, metric, tests, series, onHover }) {
  const W = 420, LABEL = 170, PAD = 14, lane = 7;
  const rowH = Math.max(20, series.length * lane + 8);
  const vals = [0];
  for (const s of series) for (const t of tests) {
    const row = s.rows[t.test];
    if (row?.delta?.[metric] != null) vals.push(row.delta[metric]);
    const e = row?.expect?.[metric];
    if (e) vals.push(e[0], e[1]);
  }
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || 1;
  lo -= span * 0.08; hi += span * 0.08;
  const x = v => LABEL + PAD + ((v - lo) / (hi - lo)) * (W - LABEL - 2 * PAD);
  const step = [0.5, 1, 2, 5, 10, 20].find(s => (hi - lo) / s <= 6) ?? 50;
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(+v.toFixed(6));
  const H = tests.length * rowH + 34;
  return (
    <div style={{flex:'1 1 420px',minWidth:0}}>
      <div style={{color:C.textBright,fontSize:'10px',letterSpacing:'.1em',marginBottom:'2px'}}>{title}</div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',maxWidth:`${W * 1.4}px`,display:'block'}} onMouseLeave={() => onHover(null)}>
        {ticks.map(v => <g key={v}>
          <line x1={x(v)} x2={x(v)} y1={4} y2={H - 22} stroke={v === 0 ? C.grey : C.border} strokeWidth={v === 0 ? 1 : 0.5} />
          <text x={x(v)} y={H - 10} fill={C.grey} fontSize="9" textAnchor="middle">{f1(v, step < 1 ? 1 : 0)}{unit}</text>
        </g>)}
        {tests.map((t, i) => {
          const y0 = 4 + i * rowH;
          const sep = i > 0 && tests[i - 1].family !== t.family;
          return <g key={t.test}>
            {sep && <line x1={0} x2={W} y1={y0} y2={y0} stroke={C.border2} strokeWidth={1} />}
            <text x={0} y={y0 + rowH / 2 + 3} fill={C.textDim} fontSize="9">
              {t.family === 'idle' ? 'idle' : t.family} · {t.setting}</text>
            {series.map((s, k) => {
              const row = s.rows[t.test];
              const y = y0 + 6 + k * lane + (rowH - 8 - series.length * lane) / 2 + lane / 2;
              const e = row?.expect?.[metric], v = row?.delta?.[metric];
              return <g key={s.rom}>
                {e && <rect x={x(e[0])} y={y - 2.5} width={Math.max(1, x(e[1]) - x(e[0]))} height={5} rx={2}
                            fill={s.col} opacity={0.28} />}
                {v != null && <>
                  <Marker shape={s.shape} x={x(v)} y={y} col={s.col} />
                  <rect x={x(v) - 9} y={y - 5} width={18} height={10} fill="transparent" style={{cursor:'default'}}
                        onMouseEnter={ev => onHover({ rect: ev.currentTarget.getBoundingClientRect(), rom: s.rom, row, metric, unit })} />
                </>}
              </g>;
            })}
          </g>;
        })}
      </svg>
    </div>
  );
}

// GET /runall/regioncat: the report, or {error}
async function fetchReport(url, sim, roms) {
  try {
    const q = `sim=${sim}${roms.length ? `&roms=${roms.map(encodeURIComponent).join(',')}` : ''}`;
    const r = await fetch(`${url}/runall/regioncat?${q}`);
    if (!r.ok) {
      const msg = await r.text();
      return { error: r.status === 404 && !msg.includes('developer')
        ? 'this bridge has no REGION/ALT/CAT report (update 944turbo_dme_klr and restart the bridge)' : `${r.status} ${msg}` };
    }
    const j = await r.json();
    return j.error ? { error: j.error } : j;
  } catch (e) { return { error: e.message }; }
}

export default function RegionCat({ url, folders, active, btn, inp }) {
  const [pick, setPick] = useState(null);      // null: every folder with these logs
  const [sim, setSim] = useState('verilator');
  const [res, setRes] = useState({ loading: true }); // {loading} | GET /runall/regioncat | {error}
  const [hover, setHover] = useState(null);
  const chartBox = useRef(null);
  // the tooltip's place, relative to the chart box, worked out on hover
  const onHover = h => {
    if (!h) return setHover(null);
    const box = chartBox.current?.getBoundingClientRect();
    setHover({ ...h, pos: { x: h.rect.left - (box?.left ?? 0) + 14, y: h.rect.top - (box?.top ?? 0) - 6 } });
  };
  const order = pick ? folders.filter(f => pick.has(f)) : [];

  const load = async (o = {}) => {
    setRes(r => ({ ...(r ?? {}), loading: true }));
    setRes(await fetchReport(url, o.sim ?? sim, o.order ?? order));
  };
  // load once when the view opens
  useEffect(() => { fetchReport(url, 'verilator', []).then(setRes); }, [url]);
  const toggle = f => {
    const n = new Set(pick ?? []);
    n.has(f) ? n.delete(f) : n.add(f);
    const next = n.size ? n : null;
    setPick(next);
    load({ order: next ? folders.filter(x => next.has(x)) : [] });
  };
  const logHref = (rom, s, test) =>
    `${window.location.pathname}?log=${encodeURIComponent(`${url}/logs/${encodeURIComponent(rom)}/${SIDE_DIR[s]}/${test}.dash.log`)}`;

  const roms = res?.roms ?? [];
  // one chart series per ROM folder and suite, coloured by the ROM's place in the folder list
  const series = [];
  for (const r of roms) for (const sd of r.sides) {
    const i = Math.max(0, folders.indexOf(r.rom)) % ROM_COL.length;
    series.push({ rom: roms.some(x => x.sides.length > 1) ? `${r.rom} ${sd.sim === 'verilator' ? 'VL' : 'IV'}` : r.rom,
                  col: ROM_COL[i], shape: SHAPES[i], rows: Object.fromEntries(sd.rows.map(x => [x.test, x])) });
  }
  const chartTests = roms[0]?.sides[0]?.rows ?? [];
  const nFail = roms.reduce((n, r) => n + r.sides.reduce((m, sd) => m + sd.rows.filter(x =>
    Object.values(x.checks ?? {}).includes('fail')).length, 0), 0);

  const th = { padding:'2px 10px 2px 0', color:C.grey, fontWeight:'normal', textAlign:'right', whiteSpace:'nowrap' };
  const td = { padding:'2px 10px 2px 0', textAlign:'right', whiteSpace:'nowrap' };

  return (
    <div style={{marginTop:'10px',borderTop:`1px solid ${C.border}`,paddingTop:'8px'}}>
      <div style={{display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap',fontSize:'10px',color:C.textDim}}>
        <span style={{color:C.textBright,letterSpacing:'.15em',fontSize:'9px'}}>REGION / ALTITUDE / CAT VS BASELINE</span>
        <span title="Each ROM pair's runs are in its own folder, tmp/dme_klr/<folder>. None ticked: every folder with these tests' logs">
          ROM folders:</span>
        {folders.map(f => <label key={f} style={{display:'flex',alignItems:'center',gap:'4px',cursor:'pointer'}}>
          <input type="checkbox" checked={!!pick?.has(f)} onChange={() => toggle(f)} />{f}</label>)}
        {!pick && <span style={{color:C.grey}}>(none ticked: all with logs)</span>}
        <label style={{display:'flex',alignItems:'center',gap:'5px'}}>logs
          <select value={sim} style={{...inp,fontSize:'10px',padding:'1px 4px'}}
            onChange={e => { setSim(e.target.value); load({ sim: e.target.value }); }}>
            <option value="verilator">Verilator</option>
            <option value="iverilog">iverilog</option>
            <option value="both">Verilator + iverilog</option>
          </select></label>
        {active && <span style={{color:C.amber}}>a run is going: tests not done yet show their older logs or none</span>}
        <button style={{...btn('s', res?.loading),marginLeft:'auto',padding:'2px 8px',fontSize:'9px'}}
          disabled={!!res?.loading} onClick={() => load()}>REFRESH</button>
      </div>
      {res?.loading && <div style={{color:C.textDim,fontSize:'10px',marginTop:'6px'}}>running region_alt_cat_report.py…</div>}
      {res?.error && <div style={{color:C.red,fontSize:'10px',marginTop:'6px'}}>{res.error}</div>}
      {res?.at && !res.loading && <div style={{color:C.textDim,fontSize:'10px',marginTop:'4px'}}>
        {roms.length === 0 ? 'no ROM folder has region/altitude/cat logs yet: run the "Region, altitude and cat" group (with its baselines) first'
          : <>{nFail ? <span style={{color:C.red}}>{nFail} test(s) with a change outside its range</span>
                     : <span style={{color:C.textBright}}>every checked change is in its range</span>}
              {` · as of ${new Date(res.at).toLocaleTimeString()}`}</>}
        {res.missing?.length > 0 && <span style={{color:C.amber}}> · no logs in {res.missing.join(', ')}</span>}
      </div>}

      {!res?.loading && roms.map(r => r.sides.map(sd => (
        <div key={`${r.rom}/${sd.sim}`} style={{marginTop:'10px'}}>
          <div style={{color:C.textBright,fontSize:'10px',letterSpacing:'.1em'}}>
            {r.rom} <span style={{color:C.textDim,letterSpacing:0}}>
              · {sd.sim === 'verilator' ? 'Verilator' : 'iverilog'} · {sd.images?.DME ?? '?'} + {sd.images?.KLR ?? '?'}</span></div>
          <div style={{overflowX:'auto'}}>
            <table style={{borderCollapse:'collapse',fontSize:'10px',color:C.textDim,marginTop:'2px'}}>
              <thead><tr style={{borderBottom:`1px solid ${C.border}`}}>
                <th style={{...th,textAlign:'left'}}>setting</th>
                <th style={{...th,textAlign:'left'}}>vs</th>
                <th style={th} title="Settled injector pulse width change against the baseline">fuel Δ</th>
                <th style={th}>expected</th>
                <th style={th} title="Settled ignition advance change against the baseline (1 half-tooth = 1.36°)">timing Δ</th>
                <th style={th}>expected</th>
                <th style={th} title="Settled rpm of the test / of the baseline">rpm</th>
                <th style={th}>Δrpm</th>
                <th style={th} title="Settled load index (49h) change">Δload</th>
                <th style={{...th,textAlign:'left'}}>verdict</th>
              </tr></thead>
              <tbody>
                {sd.rows.map((x, i) => {
                  const d = x.delta, e = x.expect ?? {};
                  const sep = i > 0 && sd.rows[i - 1].family !== x.family;
                  const ck = k => CHECK[x.checks?.[k]];
                  return (
                    <tr key={x.test} style={{borderTop: sep ? `1px solid ${C.border2}` : undefined}} title={x.detail || undefined}>
                      <td style={{...td,textAlign:'left',color:C.text}}>
                        {x.mtime ? <a href={logHref(r.rom, sd.sim, x.test)} target="_blank" rel="noreferrer"
                                       style={{color:C.text,textDecoration:'none'}} title={`${x.test}: open its .dash.log in a new tab`}>
                          {x.family === 'idle' ? 'idle' : x.family} · {x.setting}</a>
                          : <>{x.family === 'idle' ? 'idle' : x.family} · {x.setting}</>}</td>
                      <td style={{...td,textAlign:'left',color:C.grey}}>{x.baseline}</td>
                      {d ? <>
                        <td style={td}>{f1(d.fuel_pct)} %</td>
                        <td style={td}>{e.fuel_pct ? <>{rng(e.fuel_pct)} <span style={{color:ck('fuel')?.c}}>{ck('fuel')?.s}</span></>
                                                   : <span style={{color:C.grey}}>report only</span>}</td>
                        <td style={td}>{f1(d.timing_deg, 2)}°</td>
                        <td style={td}>{e.timing_deg ? <>{rng(e.timing_deg)} <span style={{color:ck('timing')?.c}}>{ck('timing')?.s}</span></>
                                                     : <span style={{color:C.grey}}>report only</span>}</td>
                        <td style={td}>{Math.round(x.own.rpm)} / {Math.round(x.base.rpm)}</td>
                        <td style={td}>{f1(d.rpm, 0)}</td>
                        <td style={td}>{f1(d.load, 0)}</td>
                      </> : <td colSpan={7} style={{...td,textAlign:'left',color:C.amber}}>{x.note}</td>}
                      <td style={{...td,textAlign:'left',color:VERDICT_COL[x.verdict] ?? C.grey}}>{x.verdict ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )))}

      {!res?.loading && series.length > 0 && <div ref={chartBox} style={{marginTop:'12px',position:'relative'}}>
        <div style={{display:'flex',gap:'14px',flexWrap:'wrap',alignItems:'center',fontSize:'10px',color:C.textDim,marginBottom:'4px'}}>
          <span style={{color:C.grey}}>change vs baseline, band = expected range:</span>
          {series.map(s => <span key={s.rom} style={{display:'flex',alignItems:'center',gap:'4px'}}>
            <svg width="12" height="12"><Marker shape={s.shape} x={6} y={6} col={s.col} /></svg>{s.rom}</span>)}
        </div>
        <div style={{display:'flex',gap:'16px',flexWrap:'wrap'}}>
          <DeltaChart title="FUEL CHANGE (%)" unit="%" metric="fuel_pct" tests={chartTests} series={series} onHover={onHover} />
          <DeltaChart title="TIMING CHANGE (°)" unit="°" metric="timing_deg" tests={chartTests} series={series} onHover={onHover} />
        </div>
        {hover && (() => {
          const { row, metric, unit, rom } = hover;
          const pos = hover.pos;
          const e = row.expect?.[metric], c = row.checks?.[metric === 'fuel_pct' ? 'fuel' : 'timing'];
          return <div style={{position:'absolute',left: pos.x, top: pos.y,
                              background:'#030803',border:`1px solid ${C.border2}`,padding:'4px 7px',fontSize:'10px',
                              color:C.textDim,pointerEvents:'none',whiteSpace:'nowrap',zIndex:5}}>
            <div style={{color:C.textBright}}>{rom} · {row.test}</div>
            <div>{f1(row.delta[metric], metric === 'fuel_pct' ? 1 : 2)}{unit} vs {row.baseline}
              {e ? <> · expected {rng(e)}{unit} <span style={{color:CHECK[c]?.c}}>{CHECK[c]?.s}</span></> : ' · report only'}</div>
            <div>{metric === 'fuel_pct' ? `${row.own.fuel_ms.toFixed(3)} vs ${row.base.fuel_ms.toFixed(3)} ms`
                                        : `${row.own.timing_ht.toFixed(1)} vs ${row.base.timing_ht.toFixed(1)} half-teeth`}</div>
          </div>;
        })()}
      </div>}

      {res?.roms && !res.loading && <div style={{color:C.grey,fontSize:'10px',marginTop:'6px'}}>
        Each value is the settled steady state (last 30 % of the run, within 15 rpm of its final rpm) of the test against
        its baseline: {FAMILY[3000]} / {FAMILY[6000]} (cat fitted, US below 1000 m) for the ramps, warm_idle_5s for the idle
        tests. The expected ranges are the validator's for that DME image (REGION_ALT_CAT_RANGES in validate_dash_log.py);
        the idle tests have none. A baseline that ran on another ROM image is not compared. Hover a row for the validator's
        detail line; click a setting to open its log. The same from the command line: dme_klr/region_alt_cat_report.py.</div>}
    </div>
  );
}
