import { useState, useEffect } from "react";

// ─────────────────────────────────────────────────────────────────
//  NEW SETUP: name a DME + KLR image pair and save it as an image setup
//  (POST <bridge>/setups). Used by the live ROM IMAGES row (＋ NEW next to
//  SETUP) and by RUN REGRESSIONS (＋ NEW SETUP next to the ROM pair picker).
//  The images are the bridge's lists (GET <bridge>/compare/<cpu>/images):
//  bin_images/<cpu>, the uploads and the images saved from edits, .mem only
//  (the sim loads .mem files), never an unsaved edit.
// ─────────────────────────────────────────────────────────────────

const C = { border:'#0d2e0d', panelBg2:'#0a150a', textDim:'#ccddcc', textBright:'#00ff80', amber:'#ffaa00', red:'#ff4444' };
const btn = (on, col = C.textBright) => ({
  padding:'4px 10px', background: on ? '#0d4a0d' : C.panelBg2, border:`1px solid ${on ? col : C.border}`,
  color: on ? col : C.textDim, fontFamily:'inherit', fontSize:'10px', letterSpacing:'0.08em', cursor:'pointer',
});
const inp = { background:'#030803', border:`1px solid ${C.border}`, color:C.textBright, fontFamily:'inherit',
              fontSize:'10px', padding:'3px 5px' };

const fileName = p => p ? String(p).split(/[\\/]/).pop() : '';
const imgLabel = i => `${i.name}${i.saved ? ' (edited)' : i.src === 'upload' ? ' (uploaded)' : ''}`;

// start: { dme, klr } image names to preselect when listed (first listed otherwise);
// onSaved(name, list): after the save, with the bridge's setups list; onCancel()
export function NewSetupForm({ url, start, onSaved, onCancel, style }) {
  const [images, setImages] = useState(null);   // { dme: [...], klr: [...] }
  const [setups, setSetups] = useState([]);
  const [form, setForm] = useState({ name: '', dme: '', klr: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const list = async cpu => {
      try {
        const r = await fetch(`${url}/compare/${cpu}/images`);
        return r.ok ? (await r.json()).filter(i => /\.mem$/i.test(i.name) && i.src !== 'edited') : [];
      } catch { return []; }
    };
    Promise.all([list('dme'), list('klr'),
                 fetch(`${url}/setups`).then(r => r.ok ? r.json() : []).catch(() => [])]).then(([dme, klr, s]) => {
      if (!live) return;
      setImages({ dme, klr });
      setSetups(s);
      const pick = (cpu, l) => [fileName(start?.[cpu])].find(n => n && l.some(i => i.name === n)) ?? l[0]?.name ?? '';
      setForm(f => ({ ...f, dme: pick('dme', dme), klr: pick('klr', klr) }));
    });
    return () => { live = false; };
  }, [url]);   // eslint-disable-line react-hooks/exhaustive-deps

  const name = form.name.trim();
  const replaces = setups.find(x => x.name === name);
  const ok = !!name && !!form.dme && !!form.klr && !replaces?.builtin && !busy;
  const save = async () => {
    if (!ok) return;
    setBusy(true); setErr(null);
    try {
      // (no JSON content type, so the bridge gets no CORS preflight)
      const r = await fetch(`${url}/setups`, { method: 'POST', body: JSON.stringify({ name, dme: form.dme, klr: form.klr }) });
      if (!r.ok) { setErr((await r.text()) || `HTTP ${r.status}`); return; }
      onSaved?.(name, await r.json().catch(() => null));
    } catch { setErr(`can't reach the simulator bridge at ${url}`); }
    finally { setBusy(false); }
  };

  return (
    <div style={{display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap',fontSize:'10px',...style}}>
      <span style={{color:C.textDim,letterSpacing:'0.1em'}}>NEW SETUP</span>
      <input value={form.name} autoFocus placeholder="setup name" style={{...inp,width:'180px'}}
             onChange={e => setForm(f => ({ ...f, name: e.target.value.replace(/[^\w .+-]/g, '_').slice(0, 64) }))}
             onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onCancel?.(); }} />
      {['dme', 'klr'].map(cpu => (
        <span key={cpu} style={{display:'inline-flex',gap:'6px',alignItems:'center'}}>
          <span style={{color:C.textDim}}>{cpu.toUpperCase()}</span>
          <select value={form[cpu]} onChange={e => setForm(f => ({ ...f, [cpu]: e.target.value }))} style={{...inp,maxWidth:'260px'}}>
            {!images && <option value="">loading…</option>}
            {images && !images[cpu].length && <option value="">no {cpu.toUpperCase()} images found</option>}
            {images?.[cpu].map(i => <option key={`${i.src}/${i.name}`} value={i.name}>{imgLabel(i)}</option>)}
          </select>
        </span>
      ))}
      <button style={{...btn(false), cursor: ok ? 'pointer' : 'not-allowed', opacity: ok ? 1 : 0.5}} disabled={!ok} onClick={save}
              title={replaces?.builtin ? `${name} is a built-in setup: pick another name`
                : `Save ${name || 'the setup'}: ${form.dme} + ${form.klr}. It is listed under SETUP (live) and with RUN REGRESSIONS' ROM pairs.`}>
        {replaces && !replaces.builtin ? 'REPLACE SETUP' : 'SAVE SETUP'}</button>
      <button style={btn(false)} onClick={() => onCancel?.()}>CANCEL</button>
      {replaces && <span style={{color:replaces.builtin ? C.red : C.amber}}>
        {replaces.builtin ? 'that name is a built-in setup' : `replaces the saved setup ${name} (${replaces.dme} + ${replaces.klr})`}</span>}
      {err && <span style={{color:C.red}}>{err}</span>}
    </div>
  );
}

// The SETUP row as the live ROM IMAGES row has it: SETUP, the picker
// (pick…, the setups from GET <bridge>/setups, ＋ New setup…), ＋ NEW, LOAD
// SETUP and ✕ for a saved one; the NEW SETUP form opens under it.
// onLoad(setup): LOAD SETUP with the setup picked ({name, dme, klr, ...});
// loadTitle(setup): its tooltip; start: the images the form starts from
export function SetupPicker({ url, disabled, onLoad, loadTitle, start, reloadKey }) {
  const [setups, setSetups] = useState([]);
  const [sel, setSel] = useState('');
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState(null);
  const load = () => url && fetch(`${url}/setups`).then(r => r.ok ? r.json() : []).catch(() => []).then(setSetups);
  useEffect(() => { load(); }, [url, reloadKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = setups.find(x => x.name === sel);
  const del = async () => {
    if (!confirm(`Delete the setup ${chosen.name}? The images stay.`)) return;
    setErr(null);
    try {
      const r = await fetch(`${url}/setups/${encodeURIComponent(chosen.name)}`, { method: 'DELETE' });
      if (!r.ok) { setErr((await r.text()) || `HTTP ${r.status}`); return; }
      setSel(''); load();
    } catch { setErr(`can't reach the simulator bridge at ${url}`); }
  };
  const off = { cursor:'not-allowed', opacity:0.5 };
  return (<>
    <span style={{display:'inline-flex',gap:'6px',alignItems:'center',flexWrap:'wrap',fontSize:'10px'}}
          title="A setup is a named DME + KLR pair">
      <span style={{color:C.textDim}}>SETUP</span>
      <select value={sel} onFocus={load} disabled={disabled} style={{...inp,maxWidth:'220px'}}
              onChange={e => { if (e.target.value === '\u0000new') { setErr(null); setAdding(true); } else setSel(e.target.value); }}>
        <option value="">pick…</option>
        {setups.map(x => <option key={x.name} value={x.name} disabled={!x.ok}>
          {x.name}{x.builtin ? '' : ' (saved)'} · {x.dme} + {x.klr}{x.ok ? '' : ' (image missing)'}</option>)}
        <option value={'\u0000new'}>＋ New setup…</option>
      </select>
      <button style={{...btn(adding), ...(disabled ? off : {})}} disabled={disabled}
              onClick={() => { setErr(null); setAdding(a => !a); }}
              title="Make a new setup: name it and pick the DME and KLR images">＋ NEW</button>
      <button style={{...btn(false), ...(disabled || !chosen?.ok ? off : {})}} disabled={disabled || !chosen?.ok}
              onClick={() => onLoad?.(chosen)} title={chosen ? loadTitle?.(chosen) : 'Pick a setup'}>LOAD SETUP</button>
      {chosen && !chosen.builtin && !disabled && (
        <button style={btn(false, C.red)} title={`Delete the setup ${chosen.name} (the images stay)`} onClick={del}>✕</button>
      )}
      {err && <span style={{color:C.red}}>{err}</span>}
    </span>
    {adding && !disabled && <NewSetupForm url={url} start={chosen ?? start}
      style={{flexBasis:'100%',borderTop:`1px solid ${C.border}`,paddingTop:'5px',marginTop:'4px'}}
      onCancel={() => setAdding(false)}
      onSaved={async (name, list) => {
        setAdding(false);
        if (Array.isArray(list)) setSetups(list); else await load();
        setSel(name);
      }} />}
  </>);
}
