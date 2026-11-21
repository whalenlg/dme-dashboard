import { useState } from "react";

// ─────────────────────────────────────────────────────────────────
//  INSTALLER TESTS: the OS installer tests on their own page, reached
//  from RUN REGRESSIONS. Each picked test installs from scratch in a clean
//  VM or container (install/run_install_test.sh), one after another,
//  without the regression run's steps 1-5.
//  Talks to dme_klr/live/runall.mjs on the bridge (944turbo_dme_klr):
//    GET  <url>/runall          installTests: each test with whether this
//                               machine can run it and why not;
//                               installRun: the current or last run
//    POST <url>/runall/installtests       {tests: [ids], ref}
//    POST <url>/runall/installtests/stop  {id}: stop that test (the next one
//                               starts) or drop it from the queue; {}: stop all
//  Progress: per test its state, the step it is on (the scripts' "==> "
//  lines) and for how long, its PASS / FAIL / SKIP lines as they come and
//  its newest output line, so a long step (a VM booting, MSYS2 installing)
//  still shows it is alive.
// ─────────────────────────────────────────────────────────────────

const C = {
  bg:'#040a04', panelBg:'#060e06', border:'#0d2e0d', border2:'#1a3a1a',
  text:'#00e060', textDim:'#ccddcc', textBright:'#00ff80', amber:'#ffaa00', red:'#ff4444', blue:'#44aaff', grey:'#557755',
};
const COL = { PASS: C.textBright, FAIL: C.red, SKIP: C.amber };
// About how long each takes (the scripts' --help), for the page only
const TYPICAL = { 'macos-install': '30-60 min', 'macos-lite': '15-25 min', 'windows-lite': 'about 10 min',
                  'windows-dev': '30-60 min', 'arch-vm': 'about 5 min',
                  'arch-lite': 'about 7 min' };
const fmt = s => {
  if (s == null || !isFinite(s)) return '—';
  s = Math.max(0, Math.round(s));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(s / 3600)} h ${String(Math.floor(s % 3600 / 60)).padStart(2, '0')} min`;
};

export default function InstallTestsPanel({ url, state, onBack, onClose }) {
  const { info, err, refresh } = state;
  const list = info?.installTests ?? [];
  const ir = info?.installRun;
  const going = !!ir?.running;
  const regressing = !!info?.run?.running;
  const hostTesting = !!info?.hosttest?.running;
  const [pick, setPick] = useState(() => new Set());
  const [ref, setRef] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showOut, setShowOut] = useState(false);
  const [armed, setArmed] = useState(null);       // a stop asks once more

  const picked = list.filter(t => t.available && pick.has(t.id)).map(t => t.id);
  const blocked = regressing ? 'a regression run is going (RUN REGRESSIONS); wait for it or stop it'
    : hostTesting ? 'the network run test is going (RUN REGRESSIONS); wait for it or stop it' : null;

  const post = async (path, body) => {
    setMsg(null);
    try {
      const r = await fetch(`${url}${path}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body ?? {}) });
      if (!r.ok) setMsg(await r.text() || `bridge answered ${r.status}`);
    } catch (e) { setMsg(e.message); }
    refresh();
  };
  const start = async () => {
    setBusy(true);
    await post('/runall/installtests', { tests: picked, ...(ref.trim() ? { ref: ref.trim() } : {}) });
    setBusy(false);
  };
  const stop = (key, body) => {
    if (armed !== key) {
      setArmed(key);
      setTimeout(() => setArmed(a => (a === key ? null : a)), 4000);
      return;
    }
    setArmed(null);
    post('/runall/installtests/stop', body);
  };

  const box = {background:C.panelBg,border:`1px solid ${C.border}`,borderRadius:'2px',padding:'10px',marginBottom:'10px'};
  const ttl = {color:C.textDim,fontSize:'9px',letterSpacing:'0.2em',textTransform:'uppercase',
               borderBottom:`1px solid ${C.border}`,paddingBottom:'4px',marginBottom:'8px',display:'flex',gap:'8px',alignItems:'baseline'};
  const btn = (v, dis) => ({padding:'6px 16px',background:v==='p'?'#0d4a0d':v==='r'?'#3a0d0d':C.panelBg,
                            border:`1px solid ${v==='p'?C.textBright:v==='r'?C.red:C.border}`,
                            color:dis?C.grey:v==='p'?C.textBright:v==='r'?C.red:C.textDim,fontFamily:'inherit',
                            fontSize:'11px',letterSpacing:'0.1em',cursor:dis?'default':'pointer',opacity:dis?.5:1});
  const inp = {background:'#030803',border:`1px solid ${C.border2}`,color:C.textBright,fontFamily:'inherit',fontSize:'11px',padding:'3px 5px'};

  const noBridge = info && info.installAvailable === undefined;
  const lite = info?.mode === 'lite';
  const tests = ir?.tests ?? [];
  const nDone = tests.filter(t => ['done', 'skipped', 'stopped', 'cancelled'].includes(t.state)).length;
  const inRun = new Set(going ? tests.map(t => t.id) : []);

  const stateLine = t => {
    if (t.state === 'running') return { icon:'◐', col:C.blue, txt:`running · ${fmt(t.elapsed_s)}` };
    if (t.state === 'queued') return { icon:'○', col:C.grey, txt:'waiting its turn' };
    if (t.state === 'cancelled') return { icon:'⊘', col:C.grey, txt:'dropped from the queue' };
    if (t.state === 'stopped') return { icon:'■', col:C.amber, txt:`stopped after ${fmt(t.elapsed_s)}` };
    if (t.state === 'skipped') return { icon:'⊘', col:C.amber, txt:`skipped: ${t.why ?? "can't run here"}` };
    return { icon:'●', col:COL[t.verdict] ?? C.red, txt:`${t.verdict} · ${t.step} · ${fmt(t.elapsed_s)}` };
  };

  return (
    <div style={{position:'fixed',inset:0,background:'#020502ee',zIndex:100,display:'flex',justifyContent:'center',overflow:'auto'}}>
      <div style={{background:C.bg,border:`1px solid #0d4a0d`,borderRadius:'4px',padding:'16px',width:'1100px',maxWidth:'96vw',
                   margin:'2vh 0',height:'fit-content',textAlign:'left',color:C.text}}>
        <div style={{display:'flex',alignItems:'baseline',gap:'12px',borderBottom:'1px solid #0d4a0d',paddingBottom:'10px',marginBottom:'12px'}}>
          <button style={{...btn('s'),padding:'3px 10px'}} onClick={onBack} title="Back to RUN REGRESSIONS; installer tests keep going">◀ RUN REGRESSIONS</button>
          <div style={{color:C.textBright,fontSize:'13px',fontFamily:"'Orbitron',monospace",letterSpacing:'0.08em'}}>▶ INSTALLER TESTS</div>
          <span style={{color:'#66ddaa',fontSize:'10px'}}>install/run_install_test.sh · {url}</span>
          <button style={{...btn('s'),marginLeft:'auto',padding:'3px 10px'}} onClick={onClose}
            title="Close; the tests keep going on the bridge">CLOSE ✕</button>
        </div>
        {err && <div style={{...box,color:C.amber}}>{err}</div>}
        {lite && <div style={{...box,color:C.textDim}}>The installer tests run from the developer install; this is the lite package.</div>}
        {noBridge && !lite && <div style={{...box,color:C.amber}}>
          INSTALLER TESTS needs the updated bridge (944turbo_dme_klr): git pull, then restart dme_klr/live/bridge.mjs.</div>}

        {info && !lite && !noBridge && <>
        {/* ── Which tests ── */}
        <div style={box}>
          <div style={ttl}>Tests<span style={{letterSpacing:0,textTransform:'none'}}>each installs from scratch in a clean VM or container, one after another</span>
            {going && <span style={{color:C.amber,letterSpacing:0,textTransform:'none'}}>(fixed while they run)</span>}</div>
          {list.map(t => {
            const dis = going || !t.available;
            const on = going ? inRun.has(t.id) : t.available && pick.has(t.id);
            return (
              <label key={t.id} style={{display:'flex',alignItems:'baseline',gap:'8px',padding:'3px 0',fontSize:'11px',
                                        cursor:dis?'default':'pointer',color:t.available ? C.textDim : C.grey}}>
                <input type="checkbox" checked={on} disabled={dis}
                  onChange={e => setPick(s => { const n = new Set(s); e.target.checked ? n.add(t.id) : n.delete(t.id); return n; })} />
                <span style={{width:'380px',color:t.available ? C.text : C.grey}}>{t.label}</span>
                <span style={{width:'90px',color:C.textDim,fontSize:'10px'}}>{TYPICAL[t.id] ?? ''}</span>
                <span style={{flex:1,fontSize:'10px',color:t.available ? C.grey : C.amber}}>
                  {t.available ? t.id : `can't run here: ${t.why}`}</span>
              </label>
            );
          })}
          <div style={{display:'flex',alignItems:'center',gap:'8px',marginTop:'8px',fontSize:'10px',color:C.textDim}}>
            <label style={{display:'flex',alignItems:'center',gap:'6px'}}
              title="The Windows tests install from GitHub at this branch or tag (push it first); default: the bridge checkout's branch">
              Windows tests' branch (--ref)
              <input value={going ? ir.ref : ref} disabled={going} placeholder="this checkout's branch" style={{...inp,width:'220px'}}
                onChange={e => setRef(e.target.value)} />
            </label>
          </div>
        </div>

        {/* ── Start / stop ── */}
        <div style={box}>
          <div style={{display:'flex',alignItems:'center',gap:'12px',flexWrap:'wrap'}}>
            {!going
              ? <button style={btn('p', !picked.length || busy || !!blocked)} disabled={!picked.length || busy || !!blocked} onClick={start}
                  title={blocked ?? undefined}>
                  {busy ? 'STARTING…' : `▶ START (${picked.length} test${picked.length === 1 ? '' : 's'})`}</button>
              : <button style={btn('r', ir.stopping)} disabled={ir.stopping} onClick={() => stop('all', {})}
                  title="Stop the running test (its VM or container is deleted) and start no more">
                  {ir.stopping ? 'STOPPING…' : armed === 'all' ? 'CONFIRM: STOP ALL?' : '■ STOP ALL'}</button>}
            {blocked && !going && <span style={{color:C.amber,fontSize:'10px'}}>Not now: {blocked}</span>}
            {msg && <span style={{color:C.red,fontSize:'10px'}}>{msg}</span>}
            {ir && <span style={{fontSize:'10px',color:going ? C.blue : C.textDim}}>
              {going ? `${nDone} of ${tests.length} done · ${fmt(ir.elapsed_s)} so far`
                : `last run: ${nDone} of ${tests.length} ended after ${fmt(ir.elapsed_s)}, ${new Date(ir.endedAt).toLocaleString()}`}
              {' '}· branch {ir.ref}</span>}
          </div>
          {ir && <div style={{color:C.textDim,fontSize:'10px',marginTop:'6px'}}>Logs: {ir.dir}</div>}
        </div>

        {/* ── Progress, one card per test ── */}
        {ir && <div style={box}>
          <div style={ttl}>Progress</div>
          {tests.map(t => {
            const s = stateLine(t);
            const key = `t:${t.id}`;
            return (
              <div key={t.id} style={{borderTop:`1px solid ${C.border}`,padding:'6px 0'}}>
                <div style={{display:'flex',alignItems:'center',gap:'10px',fontSize:'11px'}}>
                  <span style={{color:s.col,width:'14px'}}>{s.icon}</span>
                  <span style={{color:C.textBright,width:'360px'}}>{t.label}</span>
                  <span style={{color:s.col,flex:1,fontSize:'10px'}}>{s.txt}</span>
                  {going && (t.state === 'running' || t.state === 'queued') &&
                    <button style={{...btn(armed === key ? 'r' : 's'),padding:'1px 8px',fontSize:'9px'}}
                      title={t.state === 'running' ? 'Stop this test (its VM or container is deleted); the next one starts' : 'Drop it from the queue'}
                      onClick={() => stop(key, { id: t.id })}>
                      {armed === key ? 'CONFIRM?' : t.state === 'running' ? '■ STOP' : '✕ DROP'}</button>}
                </div>
                {t.state === 'running' && <div style={{margin:'4px 0 0 24px',fontSize:'10px'}}>
                  <div style={{color:C.blue}}>
                    ▸ {t.step}{t.step_s != null ? ` · ${fmt(t.step_s)}` : ''}
                  </div>
                  {t.last && <div style={{color:C.textDim,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}} title={t.last}>
                    {t.last}{t.quiet_s > 30 ? <span style={{color:C.grey}}> · no output for {fmt(t.quiet_s)}</span> : ''}</div>}
                </div>}
                {t.results.length > 0 && <div style={{margin:'4px 0 0 24px'}}>
                  {t.results.map((r, i) => (
                    <div key={i} style={{display:'flex',gap:'10px',fontSize:'10px',padding:'1px 0'}}>
                      <span style={{width:'36px',color:COL[r.status]}}>{r.status}</span>
                      <span style={{width:'260px',color:C.text}}>{r.name}</span>
                      <span style={{color:C.textDim,flex:1}}>{r.detail}</span>
                    </div>
                  ))}
                </div>}
                {(t.logFile || t.logs) && t.state !== 'queued' && <div style={{margin:'3px 0 0 24px',fontSize:'10px',color:C.grey}}>
                  {t.logFile && <>output: {t.logFile}</>}{t.logs && <> · logs: {t.logs}</>}</div>}
              </div>
            );
          })}
          <button style={{...btn('s'),padding:'2px 8px',fontSize:'9px',marginTop:'6px'}} onClick={() => setShowOut(v => !v)}>
            {showOut ? 'HIDE OUTPUT' : 'SHOW OUTPUT'}</button>
          {showOut && <pre style={{background:'#030803',border:`1px solid ${C.border}`,color:'#00cc66',fontSize:'10px',padding:'8px',
                                   maxHeight:'360px',overflow:'auto',whiteSpace:'pre-wrap',margin:'6px 0 0'}}>{ir.out.join('\n')}</pre>}
        </div>}
        </>}
      </div>
    </div>
  );
}
