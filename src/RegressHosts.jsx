import { useState } from "react";

// ─────────────────────────────────────────────────────────────────
//  REGRESSION HOSTS (in RUN REGRESSIONS): other machines on the LAN
//  that take some of the run's tests. Each runs the bridge with
//    node dme_klr/live/bridge.mjs --listen 0.0.0.0 --token <secret>
//  (lite: ./run_lite.sh --listen 0.0.0.0 --token <secret>) and must have
//  the same software (the bridge compares the simulator sources' hash).
//  The list lives on this machine's bridge (GET/POST/DELETE
//  <url>/runall/hosts), so it is remembered between sessions.
// ─────────────────────────────────────────────────────────────────

const C = { panelBg:'#060e06', border:'#0d2e0d', border2:'#1a3a1a', text:'#00e060', textDim:'#ccddcc',
            textBright:'#00ff80', amber:'#ffaa00', red:'#ff4444', blue:'#44aaff', grey:'#557755' };

export default function RegressHosts({ url, state, locked, useHosts, setUseHosts, lite }) {
  const { hosts, err, load, setHosts } = state;
  const [form, setForm] = useState({ host:'', port:'8951', threads:'4', token:'' });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const post = async body => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`${url}/runall/hosts`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      if (!r.ok) setMsg(await r.text() || `bridge answered ${r.status}`);
      else { setHosts(await r.json()); return true; }
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
    return false;
  };
  const add = async () => {
    if (await post({ host: form.host, port: +form.port, threads: +form.threads, token: form.token }))
      setForm(f => ({ ...f, host:'', token:'' }));
  };
  const remove = async id => {
    try { await fetch(`${url}/runall/hosts?id=${encodeURIComponent(id)}`, { method:'DELETE' }); } catch { /* next load */ }
    load(false);
  };
  const inp = {background:'#030803',border:`1px solid ${C.border2}`,color:C.textBright,fontFamily:'inherit',fontSize:'11px',padding:'3px 5px'};
  const small = dis => ({padding:'2px 8px',background:C.panelBg,border:`1px solid ${C.border}`,color:dis?C.grey:C.textDim,
                         fontFamily:'inherit',fontSize:'9px',letterSpacing:'.1em',cursor:dis?'default':'pointer'});
  const list = hosts?.hosts ?? [];
  const cmd = lite ? './run_lite.sh --listen 0.0.0.0 --token <secret>' : 'node dme_klr/live/bridge.mjs --listen 0.0.0.0 --token <secret>';

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap',marginBottom:'6px'}}>
        <label style={{display:'flex',alignItems:'center',gap:'6px',color:C.textDim,fontSize:'11px',opacity:locked?.55:1}}>
          <input type="checkbox" checked={useHosts} disabled={locked} onChange={e=>setUseHosts(e.target.checked)} />
          spread the tests over these hosts too
        </label>
        <span style={{color:C.textDim,fontSize:'10px'}}
          title={hosts?.local?.srchash ? `srchash ${hosts.local.srchash}: a host runs tests only when its bridge has the same` : undefined}>
          here: {hosts?.local ? `${hosts.local.version} · ${hosts.local.cpus} CPUs` : '…'}
        </span>
        {hosts?.local?.restart && <span style={{color:C.amber,fontSize:'10px'}}
          title="This bridge started before the files were updated (git pull): restart it so it runs the new code">
          ⚠ this bridge still runs {hosts.local.running}: restart it</span>}
        <button style={{...small(false),marginLeft:'auto'}} onClick={()=>load(true)} title="Ask every host again">CHECK AGAIN</button>
      </div>
      {err && <div style={{color:C.amber,fontSize:'10px'}}>{err}</div>}
      {list.map(h => {
        const st = h.status;
        const col = !st ? C.grey : st.ok ? C.textBright : C.red;
        return (
          <div key={h.id} style={{display:'flex',alignItems:'center',gap:'10px',padding:'3px 0',borderTop:`1px solid ${C.border}`,flexWrap:'wrap'}}>
            <input type="checkbox" checked={h.enabled} disabled={locked} title="Use this host"
              onChange={e=>post({ host: h.host, port: h.port, enabled: e.target.checked })} />
            <span style={{color:C.text,width:'220px'}}>{h.id}</span>
            <label style={{color:C.textDim,fontSize:'10px',display:'flex',alignItems:'center',gap:'4px'}}>threads
              <input type="number" min={1} max={64} defaultValue={h.threads} disabled={locked} style={{...inp,width:'48px'}}
                onBlur={e=>{ if (+e.target.value !== h.threads) post({ host: h.host, port: h.port, threads: +e.target.value }); }} />
            </label>
            <span style={{color:col,fontSize:'10px',flex:1,minWidth:'200px'}}>
              {!st ? 'checking…' : st.ok
                ? `✓ same software (${st.info?.version ?? '?'}) · ${st.info?.cpus ?? '?'} CPUs · ${Object.entries(st.info?.sims ?? {}).filter(([, v]) => v).map(([k]) => k).join(' + ') || 'no simulators'}${st.info?.jobs ? ` · ${st.info.jobs} job(s) running` : ''}`
                : `✗ ${st.why}`}
            </span>
            <button style={small(locked)} disabled={locked} onClick={()=>remove(h.id)} title="Forget this host">✕</button>
          </div>
        );
      })}
      {/* ── Add regression host ── */}
      <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap',padding:'6px 0 2px',borderTop:`1px solid ${C.border}`}}>
        <span style={{color:C.textDim,fontSize:'9px',letterSpacing:'.15em'}}>ADD REGRESSION HOST</span>
        <input placeholder="host name or IP" value={form.host} style={{...inp,width:'170px'}} onChange={e=>setForm({...form, host:e.target.value})} />
        <input type="number" placeholder="port" value={form.port} style={{...inp,width:'64px'}} onChange={e=>setForm({...form, port:e.target.value})} title="The bridge's --port (default 8951)" />
        <label style={{color:C.textDim,fontSize:'10px'}}>max threads <input type="number" min={1} max={64} value={form.threads}
          style={{...inp,width:'48px'}} onChange={e=>setForm({...form, threads:e.target.value})} /></label>
        <input type="password" placeholder="token" value={form.token} style={{...inp,width:'130px'}} onChange={e=>setForm({...form, token:e.target.value})}
          title="The --token the other bridge was started with" />
        <button style={small(busy || !form.host || !form.token)} disabled={busy || !form.host || !form.token} onClick={add}>＋ ADD</button>
        {msg && <span style={{color:C.red,fontSize:'10px'}}>{msg}</span>}
      </div>
      <div style={{color:C.textDim,fontSize:'10px',marginTop:'4px'}}>
        On the other machine, with the same software: <code style={{color:C.text,background:'transparent',fontSize:'10px',padding:0}}>{cmd}</code>. It answers only this
        LAN and only with the token; its tests' logs come back here, so the bars, verdicts and snapshots work as for local tests.
      </div>
    </div>
  );
}
