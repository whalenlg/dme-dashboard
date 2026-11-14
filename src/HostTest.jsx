import { useState } from "react";

// ─────────────────────────────────────────────────────────────────
//  TEST THE NETWORK RUN (in RUN REGRESSIONS): runs the bridge's
//  install/test_regress_hosts.sh (developer install) with its switches,
//  and shows its steps and PASS / FAIL / SKIP lines as they come.
//  POST <url>/runall/hosttest {dev, hostId, keep, reuse, threads, tests},
//  POST <url>/runall/hosttest/stop; its state is GET /runall's hosttest.
// ─────────────────────────────────────────────────────────────────

const C = { panelBg:'#060e06', border:'#0d2e0d', border2:'#1a3a1a', text:'#00e060', textDim:'#ccddcc',
            textBright:'#00ff80', amber:'#ffaa00', red:'#ff4444', blue:'#44aaff', grey:'#557755' };
const COL = { PASS: C.textBright, FAIL: C.red, SKIP: C.amber };
const fmt = s => s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`;

export default function HostTest({ url, info, hosts, runActive, refresh }) {
  const ht = info?.hosttest;
  const running = !!ht?.running;
  const [picked, setTarget] = useState(null);        // vm-lite | vm-dev | <host id>
  const [keep, setKeep] = useState(false);
  const [reuse, setReuse] = useState(false);
  const [threads, setThreads] = useState('2');
  const [tests, setTests] = useState('');
  const [msg, setMsg] = useState(null);
  const [showOut, setShowOut] = useState(false);
  const canVm = !!info?.tart;
  const target = picked ?? (canVm || !hosts.length ? 'vm-lite' : hosts[0].id);
  const vm = target.startsWith('vm-');
  const avail = !!info?.hosttestAvailable;
  const disabled = !avail || running || runActive;

  const inp = {background:'#030803',border:`1px solid ${C.border2}`,color:C.textBright,fontFamily:'inherit',fontSize:'11px',padding:'3px 5px'};
  const lbl = dis => ({display:'flex',alignItems:'center',gap:'6px',color:dis?C.grey:C.textDim,opacity:dis?.55:1,fontSize:'11px',cursor:dis?'not-allowed':'pointer'});
  const btn = (col, dis) => ({padding:'4px 12px',background:C.panelBg,border:`1px solid ${dis ? C.border : col}`,color:dis?C.grey:col,
                              fontFamily:'inherit',fontSize:'10px',letterSpacing:'.1em',cursor:dis?'default':'pointer'});

  const post = async (path, body) => {
    setMsg(null);
    try {
      const r = await fetch(`${url}${path}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body ?? {}) });
      if (!r.ok) setMsg(await r.text() || `bridge answered ${r.status}`);
    } catch (e) { setMsg(e.message); }
    refresh?.();
  };
  const start = () => post('/runall/hosttest', {
    ...(vm ? { dev: target === 'vm-dev', keep, reuse } : { hostId: target }),
    threads: +threads || 2,
    tests: tests.split(/[\s,]+/).filter(Boolean),
  });

  if (!avail) return (
    <div style={{color:C.textDim,fontSize:'10px'}}>
      The network run test (install/test_regress_hosts.sh) runs from the developer install; this is the lite package.
    </div>
  );

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',gap:'14px',flexWrap:'wrap'}}>
        <label style={{color:C.textDim,fontSize:'10px',display:'flex',alignItems:'center',gap:'6px'}}>SECOND MACHINE
          <select value={target} disabled={disabled} style={inp} onChange={e=>setTarget(e.target.value)}
            title="A macOS VM made on this Mac (Tart), or a host from the list above">
            <option value="vm-lite" disabled={!canVm}>macOS VM: lite package (quick)</option>
            <option value="vm-dev" disabled={!canVm}>macOS VM: developer install (--dev, adds iverilog)</option>
            {hosts.map(h => <option key={h.id} value={h.id}>{h.id} (--host)</option>)}
          </select>
        </label>
        <label style={lbl(disabled || !vm)} title="--keep: leave the VM and its bridge running at the end">
          <input type="checkbox" checked={vm && keep} disabled={disabled || !vm} onChange={e=>setKeep(e.target.checked)} />keep the VM (--keep)</label>
        <label style={lbl(disabled || !vm)} title="--reuse: use the VM a --keep run left, instead of making one">
          <input type="checkbox" checked={vm && reuse} disabled={disabled || !vm} onChange={e=>setReuse(e.target.checked)} />reuse it (--reuse)</label>
        <label style={{...lbl(disabled),cursor:'default'}}>host threads (--threads)
          <input type="number" min={1} max={64} value={threads} disabled={disabled} style={{...inp,width:'48px'}} onChange={e=>setThreads(e.target.value)} /></label>
        <label style={{...lbl(disabled),cursor:'default'}}>tests (--tests)
          <input placeholder="six 5-second tests" value={tests} disabled={disabled} style={{...inp,width:'220px'}} onChange={e=>setTests(e.target.value)} /></label>
      </div>
      {!canVm && <div style={{color:C.amber,fontSize:'10px',marginTop:'4px'}}>
        A VM needs macOS on Apple Silicon with Tart; here, pick a host from the list (it needs --listen and its token saved above).</div>}
      <div style={{display:'flex',alignItems:'center',gap:'12px',marginTop:'8px',flexWrap:'wrap'}}>
        {!running
          ? <button style={btn(C.textBright, disabled || (vm && !canVm))} disabled={disabled || (vm && !canVm)} onClick={start}
              title={runActive ? 'Not while a regression run is going' : 'Run install/test_regress_hosts.sh'}>▶ TEST THE NETWORK RUN</button>
          : <button style={btn(C.red, !!ht?.stopping)} disabled={!!ht?.stopping} onClick={()=>post('/runall/hosttest/stop')}
              title="Stop it (a VM it made is deleted unless --keep)">{ht?.stopping ? 'STOPPING…' : '■ STOP TEST'}</button>}
        {ht && <span style={{fontSize:'10px',color: running ? C.blue : ht.exit === 0 ? C.textBright : C.red}}>
          {running ? '◐ ' : ''}{ht.step} · {fmt(ht.elapsed_s)}{running && ht.step?.startsWith('Setting up') ? ' (the VM setup takes minutes)' : ''}</span>}
        {msg && <span style={{color:C.red,fontSize:'10px'}}>{msg}</span>}
      </div>
      {ht && <>
        <div style={{color:C.textDim,fontSize:'10px',margin:'4px 0',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}} title={ht.command}>
          {ht.target} · {ht.command}</div>
        {ht.results.map((r, i) => (
          <div key={i} style={{display:'flex',gap:'10px',fontSize:'10px',padding:'1px 0'}}>
            <span style={{width:'36px',color:COL[r.status]}}>{r.status}</span>
            <span style={{width:'260px',color:C.text}}>{r.name}</span>
            <span style={{color:C.textDim,flex:1}}>{r.detail}</span>
          </div>
        ))}
        {ht.logs && <div style={{color:C.textDim,fontSize:'10px',marginTop:'4px'}}>Logs: {ht.logs}</div>}
        <button style={{...btn(C.textDim,false),padding:'2px 8px',fontSize:'9px',marginTop:'6px'}} onClick={()=>setShowOut(v=>!v)}>
          {showOut ? 'HIDE OUTPUT' : 'SHOW OUTPUT'}</button>
        {showOut && <pre style={{background:'#030803',border:`1px solid ${C.border}`,color:'#00cc66',fontSize:'10px',padding:'8px',
                                 maxHeight:'320px',overflow:'auto',whiteSpace:'pre-wrap',margin:'6px 0 0'}}>{ht.out.join('\n')}</pre>}
      </>}
    </div>
  );
}
