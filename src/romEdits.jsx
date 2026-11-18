import { useState, useEffect, useRef } from "react";
import { MODIFIED, isEdited, shownName, fileOf } from "./romNames.js";

// ─────────────────────────────────────────────────────────────────
//  EDITED ROM IMAGES
//  Bytes edited in the DME CODE / KLR CODE windows (POST <bridge>/patch)
//  make an image named <name>.patch-<hash>.mem. Wherever an image name is
//  shown it goes through RomName: an edited image shows its original name
//  in red with "(modified)", and clicking it opens the list of edits
//  (GET <bridge>/edits/<cpu>?name=<file>) as text that can be copied.
// ─────────────────────────────────────────────────────────────────

const C = { panelBg:'#060e06', panelBg2:'#0a150a', border:'#0d2e0d', text:'#00e060', textDim:'#ccddcc',
            textBright:'#00ff80', red:'#ff4444' };
// An image name. Edited: red, "(modified)", click for the edits.
// cpu: dme|klr; bridge: the bridge's URL (no bridge: not clickable)
export function RomName({ path, cpu, bridge, style, title }) {
  const [openName, setOpenName] = useState(null);   // the image whose list is open
  const edited = isEdited(path);
  // (the list stays open when SAVE AS swaps the EPROM to the saved image)
  const list = openName && <EditsList bridge={bridge} cpu={cpu} name={openName} onClose={() => setOpenName(null)} />;
  if (!edited) return <><span style={style} title={title ?? fileOf(path)}>{shownName(path)}</span>{list}</>;
  return (
    <>
      <span style={{...style, color:MODIFIED, cursor: bridge ? 'pointer' : 'inherit'}}
            title={`${fileOf(path)}: ${shownName(path)} with bytes edited in the ${cpu?.toUpperCase()} CODE window${bridge ? '.\nClick for the list of edits' : ''}`}
            onClick={e => { if (bridge) { e.stopPropagation(); setOpenName(fileOf(path)); } }}>
        {shownName(path)} <span style={{fontWeight:'bold'}}>(modified)</span>
      </span>
      {list}
    </>
  );
}

// The edits as text: each changed place with its code before and after
export function EditsList({ bridge, cpu, name, onClose }) {
  const [res, setRes] = useState(null);   // {text, ...} | {error}
  const [copied, setCopied] = useState(false);
  const area = useRef(null);
  useEffect(() => {
    let stop = false;
    fetch(`${bridge}/edits/${cpu}${name ? `?name=${encodeURIComponent(name)}` : ''}`)
      .then(async r => r.ok ? r.json() : Promise.reject(new Error((await r.text()) || `HTTP ${r.status}`)))
      .then(d => { if (!stop) setRes(d); })
      .catch(e => { if (!stop) setRes({ error: e.message === 'Failed to fetch' ? `can't reach the simulator bridge at ${bridge}` : e.message }); });
    return () => { stop = true; };
  }, [bridge, cpu, name]);
  const copy = async () => {
    const el = area.current;
    if (!el) return;
    // The clipboard of the window this is in (the code windows are windows of their own)
    const win = el.ownerDocument.defaultView;
    try { await win.navigator.clipboard.writeText(el.value); }
    catch { el.select(); el.ownerDocument.execCommand('copy'); }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const lines = res?.text ? res.text.split('\n').length : 8;
  return (
    <div onClick={e => { e.stopPropagation(); onClose(); }}
         style={{position:'fixed',inset:0,background:'#000c',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center',padding:'16px',cursor:'default'}}>
      <div onClick={e => e.stopPropagation()}
           style={{background:C.panelBg,border:`1px solid ${C.border}`,padding:'10px 12px',width:'min(900px, 100%)',maxHeight:'100%',
                   display:'flex',flexDirection:'column',gap:'8px',textAlign:'left',fontSize:'11px',whiteSpace:'normal'}}>
        <div style={{display:'flex',gap:'10px',alignItems:'baseline',flexWrap:'wrap'}}>
          <span style={{color:C.textBright,fontSize:'12px',letterSpacing:'0.1em'}}>{cpu?.toUpperCase()} ROM EDITS</span>
          <span style={{color:MODIFIED}}>{shownName(res?.name ?? name)} (modified)</span>
          {res?.text && <span style={{color:C.textDim}}>{res.bytes} byte{res.bytes !== 1 ? 's' : ''} changed in {res.places} place{res.places !== 1 ? 's' : ''}</span>}
          <span style={{marginLeft:'auto',display:'inline-flex',gap:'6px'}}>
            <button onClick={copy} disabled={!res?.text}
                    style={{background:copied ? '#0d4a0d' : C.panelBg2,border:`1px solid ${copied ? C.textBright : C.border}`,color:copied ? C.textBright : C.textDim,
                            fontFamily:'inherit',fontSize:'10px',cursor:'pointer',padding:'3px 10px',letterSpacing:'0.08em'}}
                    title="Copy the list, to paste into a text editor">{copied ? '✓ COPIED' : 'COPY'}</button>
            <button onClick={onClose}
                    style={{background:C.panelBg2,border:`1px solid ${C.border}`,color:C.textDim,fontFamily:'inherit',fontSize:'10px',cursor:'pointer',padding:'3px 10px'}}>CLOSE ✕</button>
          </span>
        </div>
        {!res && <div style={{color:C.textDim}}>asking the simulator bridge…</div>}
        {res?.error && <div style={{color:C.red}}>Can't list the edits: {res.error}</div>}
        {res && !res.error && !res.text && <div style={{color:C.textDim}}>This image has no edits.</div>}
        {res?.text && (
          <textarea ref={area} readOnly value={res.text} spellCheck={false} onFocus={e => e.target.select()}
                    rows={Math.min(40, lines + 1)}
                    style={{background:'#030803',border:`1px solid ${C.border}`,color:C.textBright,fontFamily:"'Share Tech Mono','Courier New',monospace",
                            fontSize:'11px',lineHeight:1.35,padding:'6px 8px',resize:'vertical',whiteSpace:'pre',overflow:'auto',minHeight:'120px'}} />
        )}
        <div style={{color:'#779977',fontSize:'10px'}}>
          Each place lists the code as loaded (was) and as edited (now). Bytes are hex; addresses are {cpu === 'dme' ? '4' : '3'} hex digits.
        </div>
        {res?.text && <SaveAs bridge={bridge} cpu={cpu} from={res.name} base={res.base} />}
      </div>
    </div>
  );
}

const inp = { background:'#030803', border:`1px solid ${C.border}`, color:C.textBright, fontFamily:'inherit', fontSize:'10px', padding:'3px 5px' };
const btn = col => ({ background:C.panelBg2, border:`1px solid ${col ?? C.border}`, color:col ?? C.textDim, fontFamily:'inherit',
                      fontSize:'10px', cursor:'pointer', padding:'3px 10px', letterSpacing:'0.08em' });
const post = async (url, body) => {
  const r = await fetch(url, { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
  return r.headers.get('content-type')?.includes('json') ? r.json() : null;
};

// SAVE AS: keep the edited image as an image of its own (<name>.mem among the
// bridge's uploads), then optionally pair it with an image for the other CPU
// as a setup: LIVE loads a setup from the ROM IMAGES row, RUN REGRESSIONS
// lists it with the ROM pairs.
function SaveAs({ bridge, cpu, from, base }) {
  const CPU = cpu.toUpperCase(), other = cpu === 'dme' ? 'klr' : 'dme';
  const [name, setName] = useState(`${shownName(base ?? from).replace(/\.mem$/i, '')}_edited`);
  const [use, setUse] = useState(true);
  const [saved, setSaved] = useState(null);   // file name
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr(null);
    try { setSaved((await post(`${bridge}/edits/${cpu}/save`, { name, from, use })).name); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };
  // the setup: this image and one for the other CPU
  const [images, setImages] = useState([]);
  const [pair, setPair] = useState('');
  const [setupName, setSetupName] = useState('');
  const [setupDone, setSetupDone] = useState(null);
  useEffect(() => {
    if (!saved) return;
    setSetupName(saved.replace(/\.mem$/i, ''));
    fetch(`${bridge}/compare/${other}/images`).then(r => r.ok ? r.json() : [])
      .then(list => {
        const mems = list.filter(i => /\.mem$/i.test(i.name) && i.src !== 'edited');
        setImages(mems);
        // the other EPROM's image as loaded now, when it's in the list
        fetch(`${bridge}/edits/${other}`).then(r => r.ok ? r.json() : null).catch(() => null).then(d => {
          const now = shownName(d?.base ?? d?.name);
          setPair(p => p || (mems.some(i => i.name === now) ? now : mems[0]?.name ?? ''));
        });
      }).catch(() => {});
  }, [saved, bridge, other]);
  const saveSetup = async () => {
    setBusy(true); setErr(null);
    try {
      await post(`${bridge}/setups`, { name: setupName.trim(), [cpu]: saved, [other]: pair });
      setSetupDone(setupName.trim());
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };
  return (
    <div style={{borderTop:`1px solid ${C.border}`,paddingTop:'8px',display:'flex',flexDirection:'column',gap:'6px'}}>
      {!saved ? (
        <div style={{display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
          <span style={{color:C.textDim,letterSpacing:'0.1em'}}>SAVE AS NEW IMAGE</span>
          <input value={name} onChange={e => setName(e.target.value.replace(/[^\w.+-]/g, '_'))} style={{...inp,width:'240px'}}
                 onKeyDown={e => e.key === 'Enter' && name && save()} />
          <span style={{color:C.textDim}}>.mem</span>
          <label style={{color:C.textDim,cursor:'pointer'}} title={`Swap the ${CPU} EPROM to the saved image now (paused only); otherwise it stays on the edited one`}>
            <input type="checkbox" checked={use} onChange={e => setUse(e.target.checked)} /> run it now
          </label>
          <button style={btn(C.textBright)} disabled={busy || !name} onClick={save}
                  title={`Keep these edits as ${name}.mem: it is listed wherever ${CPU} images are (LOAD .mem, COMPARE IMAGES, RUN REGRESSIONS, setups), with this list saved beside it`}>SAVE</button>
        </div>
      ) : (<>
        <div style={{color:C.textBright}}>✓ Saved as {saved}{use ? ` and loaded into the ${CPU} EPROM` : ''}. It is in every {CPU} image list now.</div>
        {!setupDone ? (
          <div style={{display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}
               title="A setup is a named DME + KLR pair: LIVE loads it from the ROM IMAGES row (SETUP), and RUN REGRESSIONS lists it with the ROM pairs">
            <span style={{color:C.textDim,letterSpacing:'0.1em'}}>MAKE A SETUP</span>
            <input value={setupName} onChange={e => setSetupName(e.target.value)} style={{...inp,width:'180px'}} placeholder="setup name" />
            <span style={{color:C.textDim}}>{CPU} {saved} +</span>
            <span style={{color:C.textDim}}>{other.toUpperCase()}</span>
            <select value={pair} onChange={e => setPair(e.target.value)} style={inp}>
              {images.map(i => <option key={i.name} value={i.name}>{i.name}{i.src === 'upload' ? ' (uploaded)' : ''}</option>)}
            </select>
            <button style={btn(C.textBright)} disabled={busy || !setupName.trim() || !pair} onClick={saveSetup}>SAVE SETUP</button>
          </div>
        ) : (
          <div style={{color:C.textBright}}>✓ Setup “{setupDone}” saved: pick it under SETUP in the ROM IMAGES row (live), or in RUN REGRESSIONS’ ROM pair list.</div>
        )}
      </>)}
      {err && <div style={{color:C.red}}>{err}</div>}
    </div>
  );
}
