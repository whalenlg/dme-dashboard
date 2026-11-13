// ════════════════════════════════════════════════════════════════════
//  COMPARE ROM IMAGES (live page): what differs between two DME or two
//  KLR EPROM images, before anything is simulated. The bridge runs
//  dme_klr/live/rom_compare.py (944turbo_dme_klr):
//    GET <bridge>/compare/<cpu>/images         the images it knows (repo + uploads)
//    GET <bridge>/compare/<cpu>?a=<name>&b=<name>[&all=1]
//    GET <bridge>/compare/<cpu>/variants?ref=<name>   every image vs the reference
//  The calibration maps and tables are decoded from each image the way
//  the firmware reads them and shown side by side, differing cells
//  marked; every other run of differing bytes (code, constants, index
//  tables) comes with the nearest label and the disassembly around it.
// ════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";

const C = {
  panelBg:'#060e06', panelBg2:'#0a150a', border:'#0d2e0d', border2:'#1a3a1a',
  text:'#00e060', textDim:'#ccddcc', textBright:'#00ff80', amber:'#ffaa00', red:'#ff4444', blue:'#44aaff',
};
const A_COL = '#66ccff', B_COL = '#ffaa66';
const hx = (v, n = 2) => v == null || isNaN(v) ? '--' : v.toString(16).toUpperCase().padStart(n, '0');
const btn = (on, col = C.textBright) => ({
  padding:'4px 10px', background: on ? '#0d4a0d' : C.panelBg2, border:`1px solid ${on ? col : C.border}`,
  color: on ? col : C.textDim, fontFamily:'inherit', fontSize:'10px', letterSpacing:'0.08em', cursor:'pointer',
});
const sel = { background:'#030803', border:`1px solid ${C.border}`, color:C.textBright, fontFamily:'inherit',
              fontSize:'10px', padding:'3px 5px', maxWidth:'260px' };
const panel = { background:C.panelBg, border:`1px solid ${C.border}`, borderRadius:'2px', padding:'8px 10px' };
const title = { color:C.textDim, fontSize:'9px', letterSpacing:'0.2em', textTransform:'uppercase', marginBottom:'6px' };
const cellTd = { padding:'1px 4px', fontFamily:"'Courier New',monospace", fontSize:'10px', textAlign:'right' };

const baseName = p => p ? p.split(/[\\/]/).pop() : null;
const rowsOf = v => v == null ? [] : Array.isArray(v[0]) ? v : [v];

// One map or table: A and B as grids, the cells that differ outlined
function ValuesGrid({ va, vb, side }) {
  const mine = rowsOf(side === 'a' ? va : vb), other = rowsOf(side === 'a' ? vb : va);
  if (!mine.length) return <div style={{color:C.textDim,fontSize:'10px'}}>not in this image</div>;
  const col = side === 'a' ? A_COL : B_COL;
  return (
    <table style={{borderCollapse:'collapse'}}>
      <tbody>
        {mine.map((r, i) => (
          <tr key={i}>
            {r.map((v, j) => {
              const d = other[i]?.[j] !== v;
              return <td key={j} style={{...cellTd, color: d ? col : '#557755',
                                         background: d ? 'rgba(255,255,255,0.06)' : 'none',
                                         outline: d ? `1px solid ${col}55` : 'none'}}>{hx(v)}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const axisText = x => x ? `${x.name ?? 'axis'}${x.addr != null ? ` @${hx(x.addr, 4)}h` : ''}${x.raw ? ` [${x.raw.map(v => hx(v)).join(' ')}]` : ''}` : null;

function CalibEntry({ e }) {
  const [open, setOpen] = useState(false);
  const where = e.only === 'a' ? 'only in A' : e.only === 'b' ? 'only in B'
    : e.moved ? `A @${hx(e.addr_a, 4)}h → B @${hx(e.addr_b, 4)}h` : `@${hx(e.addr_a ?? e.addr_b, 4)}h`;
  const what = [e.cells ? `${e.cells} value${e.cells > 1 ? 's' : ''}` : null, e.axis_changed ? 'axis' : null,
                e.moved ? 'moved' : null].filter(Boolean).join(' · ') || (e.changed ? 'changed' : 'same');
  return (
    <div style={{borderTop:`1px solid ${C.border}`,padding:'4px 0'}}>
      <div style={{display:'flex',gap:'10px',alignItems:'baseline',cursor:'pointer',fontSize:'10px'}} onClick={() => setOpen(o => !o)}>
        <span style={{color:C.textDim,width:'10px'}}>{open ? '▾' : '▸'}</span>
        <span style={{color:C.textBright,minWidth:'170px'}}>{e.name}{e.id && e.id !== e.name ? ` (${e.id})` : ''}</span>
        <span style={{color:C.textDim,minWidth:'60px'}}>{e.kind}</span>
        <span style={{color:C.textDim,minWidth:'170px'}}>{where}</span>
        <span style={{color: e.changed ? C.amber : C.textDim}}>{what}</span>
        {e.purpose && <span style={{color:'#779977'}}>{e.purpose}</span>}
      </div>
      {open && (
        <div style={{display:'flex',gap:'18px',flexWrap:'wrap',padding:'6px 0 4px 20px'}}>
          {['a', 'b'].map(s => (
            <div key={s} style={{minWidth:0,overflowX:'auto'}}>
              <div style={{color: s === 'a' ? A_COL : B_COL,fontSize:'9px',letterSpacing:'0.15em',marginBottom:'3px'}}>{s.toUpperCase()}</div>
              {['x', 'y'].map(k => { const t = axisText(e[`${k}_${s}`]); return t && <div key={k} style={{color:C.textDim,fontSize:'9px'}}>{k}: {t}</div>; })}
              <ValuesGrid va={e.values_a} vb={e.values_b} side={s} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Listing({ rows, col }) {
  if (!rows) return <div style={{color:C.textDim,fontSize:'10px'}}>no disassembly for this image</div>;
  return (
    <div style={{fontFamily:"'Courier New',monospace",fontSize:'10px',whiteSpace:'pre'}}>
      {rows.map(r => (
        <div key={r.a}>
          <span style={{color:'#557755'}}>{hx(r.a, 4)} </span>
          <span style={{color:col}}>{(r.label ?? '').padEnd(14).slice(0, 24)} </span>
          <span style={{color:C.textBright}}>{(r.instr ?? '').padEnd(6)} </span>
          <span style={{color:C.textDim}}>{r.ops}</span>
        </div>
      ))}
    </div>
  );
}

function CodeRun({ r }) {
  const [open, setOpen] = useState(false);
  const n = r.end - r.start + 1;
  return (
    <div style={{borderTop:`1px solid ${C.border}`,padding:'4px 0'}}>
      <div style={{display:'flex',gap:'10px',alignItems:'baseline',cursor:'pointer',fontSize:'10px'}} onClick={() => setOpen(o => !o)}>
        <span style={{color:C.textDim,width:'10px'}}>{open ? '▾' : '▸'}</span>
        <span style={{color:C.textBright,minWidth:'90px'}}>{hx(r.start, 4)}{n > 1 ? `–${hx(r.end, 4)}` : ''}h</span>
        <span style={{color:C.textDim,minWidth:'60px'}}>{n} byte{n > 1 ? 's' : ''}</span>
        <span style={{color:A_COL,minWidth:'180px'}}>{r.at_a ?? ''}</span>
        {r.at_b !== r.at_a && <span style={{color:B_COL}}>{r.at_b ?? ''}</span>}
      </div>
      {open && (
        <div style={{padding:'6px 0 4px 20px'}}>
          <div style={{fontFamily:"'Courier New',monospace",fontSize:'10px',wordBreak:'break-all'}}>
            <div><span style={{color:A_COL}}>A </span><span style={{color:C.textDim}}>{r.bytes_a}</span></div>
            <div><span style={{color:B_COL}}>B </span><span style={{color:C.textDim}}>{r.bytes_b}</span></div>
          </div>
          <div style={{display:'flex',gap:'24px',flexWrap:'wrap',marginTop:'6px'}}>
            <div style={{minWidth:0,overflowX:'auto'}}><div style={{color:A_COL,fontSize:'9px'}}>A</div><Listing rows={r.rows_a} col={A_COL} /></div>
            <div style={{minWidth:0,overflowX:'auto'}}><div style={{color:B_COL,fontSize:'9px'}}>B</div><Listing rows={r.rows_b} col={B_COL} /></div>
          </div>
        </div>
      )}
    </div>
  );
}

// Every image against the reference (A), map by map: one column per
// image, "=" where it matches; a click opens that pair
function VariantsTable({ v, all, openPair }) {
  const maps = all ? v.maps : v.maps.filter(m => m.differs);
  const ref = v.images[0].name;
  const th = { padding:'2px 6px', color:C.textDim, fontWeight:'normal', fontSize:'9px', textAlign:'center', verticalAlign:'bottom' };
  const cellOf = c => {
    if (!c) return { t: '—', col: '#557755', tip: 'not in this image' };
    if (c.cells == null) return { t: 'new', col: B_COL, tip: `@${hx(c.addr, 4)}h, not in the reference` };
    const parts = [c.cells ? `${c.cells}` : null, c.axis ? 'ax' : null, c.moved ? 'mv' : null].filter(Boolean);
    return parts.length
      ? { t: parts.join(' '), col: C.amber, tip: `@${hx(c.addr, 4)}h: ${c.cells} value${c.cells !== 1 ? 's' : ''} differ${c.axis ? ', axis differs' : ''}${c.moved ? ', moved' : ''}` }
      : { t: '=', col: '#557755', tip: `@${hx(c.addr, 4)}h, same as the reference` };
  };
  return (
    <div style={{overflowX:'auto',marginTop:'8px'}}>
      <div style={{color:C.textDim,marginBottom:'4px'}}>
        Against <span style={{color:A_COL}}>{ref}</span>: values that differ, <b>ax</b> axis differs, <b>mv</b> moved, — not in that image. Click a cell for the side-by-side compare.
      </div>
      <table style={{borderCollapse:'collapse',fontSize:'10px'}}>
        <thead>
          <tr>
            <th style={{...th,textAlign:'left'}}>map / table</th>
            {v.images.map((im, i) => (
              <th key={im.name} style={{...th,color: i === 0 ? A_COL : C.textBright,maxWidth:'120px',wordBreak:'break-all'}} title={`sha ${im.sha}`}>
                {im.name}{i === 0 ? ' (ref)' : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr style={{borderTop:`1px solid ${C.border}`}}>
            <td style={{padding:'2px 6px',color:C.textBright}}>all bytes</td>
            {v.code.map((c, i) => (
              <td key={i} style={{padding:'2px 6px',textAlign:'center',color: c.diff_bytes ? C.amber : '#557755',cursor: i ? 'pointer' : 'default'}}
                  title={i ? `${c.diff_bytes} bytes differ; ${c.bytes} of them outside the maps, in ${c.runs} run${c.runs !== 1 ? 's' : ''}` : ''}
                  onClick={() => i && openPair(v.images[i].name)}>
                {i === 0 ? '' : c.diff_bytes ? `${c.diff_bytes}` : '='}
              </td>
            ))}
          </tr>
          <tr>
            <td style={{padding:'2px 6px',color:C.textBright}}>code / other bytes</td>
            {v.code.map((c, i) => (
              <td key={i} style={{padding:'2px 6px',textAlign:'center',color: c.bytes ? C.amber : '#557755',cursor: i ? 'pointer' : 'default'}}
                  onClick={() => i && openPair(v.images[i].name)}>
                {i === 0 ? '' : c.bytes ? `${c.bytes} in ${c.runs}` : '='}
              </td>
            ))}
          </tr>
          {maps.map(m => (
            <tr key={m.key} style={{borderTop:`1px solid ${C.border}`}}>
              <td style={{padding:'2px 6px',color:C.textDim,whiteSpace:'nowrap'}}>{m.name}{m.id && m.id !== m.name ? ` (${m.id})` : ''} <span style={{color:'#557755'}}>{m.kind}</span></td>
              {m.cells.map((c, i) => {
                const x = i === 0 ? { t: c ? `${hx(c.addr, 4)}h` : '—', col: A_COL, tip: '' } : cellOf(c);
                return <td key={i} title={x.tip} onClick={() => i && openPair(v.images[i].name)}
                           style={{padding:'2px 6px',textAlign:'center',color:x.col,cursor: i ? 'pointer' : 'default',whiteSpace:'nowrap'}}>{x.t}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function RomCompare({ url, roms, onClose }) {
  const [cpu, setCpu] = useState('dme');
  const [images, setImages] = useState({ dme: null, klr: null });
  const [pick, setPick] = useState({ dme: { a: '', b: '' }, klr: { a: '', b: '' } });
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [all, setAll] = useState(false);
  const [mode, setMode] = useState('pair');   // pair | variants
  const [vres, setVres] = useState(null);

  // The images the bridge can compare; A starts as the loaded one
  useEffect(() => {
    if (images[cpu]) return;
    fetch(`${url}/compare/${cpu}/images`).then(r => r.ok ? r.json() : Promise.reject(new Error(`bridge answered ${r.status}`)))
      .then(list => {
        setImages(m => ({ ...m, [cpu]: list }));
        const names = list.map(i => i.name);
        const loaded = baseName(roms?.[cpu]);
        setPick(p => {
          const a = p[cpu].a || (names.includes(loaded) ? loaded : names[0] ?? '');
          const b = p[cpu].b || names.find(n => n !== a && /\.mem$/i.test(n)) || names.find(n => n !== a) || '';
          return { ...p, [cpu]: { a, b } };
        });
      })
      .catch(e => setErr(`Can't list the ${cpu.toUpperCase()} images (${e.message}). This needs a bridge from 944turbo_dme_klr with rom_compare.py.`));
  }, [cpu, images, url, roms]);

  const { a, b } = pick[cpu];
  const run = () => {
    setBusy(true); setErr(null); setRes(null);
    fetch(`${url}/compare/${cpu}?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}${all ? '&all=1' : ''}`)
      .then(async r => r.ok ? r.json() : Promise.reject(new Error(await r.text())))
      .then(setRes).catch(e => setErr(e.message)).finally(() => setBusy(false));
  };
  const runVariants = () => {
    setBusy(true); setErr(null); setVres(null);
    fetch(`${url}/compare/${cpu}/variants?ref=${encodeURIComponent(a)}`)
      .then(async r => r.ok ? r.json() : Promise.reject(new Error(await r.text())))
      .then(setVres).catch(e => setErr(e.message)).finally(() => setBusy(false));
  };
  const openPair = name => {
    setPick(p => ({ ...p, [cpu]: { ...p[cpu], b: name } }));
    setMode('pair'); setBusy(true); setErr(null); setRes(null);
    fetch(`${url}/compare/${cpu}?a=${encodeURIComponent(a)}&b=${encodeURIComponent(name)}${all ? '&all=1' : ''}`)
      .then(async r => r.ok ? r.json() : Promise.reject(new Error(await r.text())))
      .then(setRes).catch(e => setErr(e.message)).finally(() => setBusy(false));
  };
  const setSide = (k, v) => setPick(p => ({ ...p, [cpu]: { ...p[cpu], [k]: v } }));
  const list = images[cpu] ?? [];
  const opt = i => <option key={`${i.src}:${i.name}`} value={i.name}>{i.name}{i.src === 'upload' ? ' (uploaded)' : ''}</option>;
  const changed = res?.calib.filter(e => e.changed) ?? [];

  return (
    <div style={{...panel,fontSize:'10px',textAlign:'left',lineHeight:'1.5'}}>
      <div style={{display:'flex',gap:'10px',alignItems:'center',flexWrap:'wrap'}}>
        <span style={{...title,marginBottom:0}}>COMPARE ROM IMAGES</span>
        {['dme', 'klr'].map(c => <button key={c} style={btn(cpu === c)} onClick={() => { setCpu(c); setRes(null); setVres(null); setErr(null); }}>{c.toUpperCase()}</button>)}
        <span style={{color:'#335533'}}>|</span>
        <button style={btn(mode === 'pair', C.blue)} onClick={() => setMode('pair')} title="Two images side by side">TWO IMAGES</button>
        <button style={btn(mode === 'variants', C.blue)} onClick={() => setMode('variants')} title="Every image against one reference, map by map">ALL VARIANTS</button>
        <span style={{color:A_COL}}>{mode === 'pair' ? 'A' : 'REF'}</span>
        <select style={sel} value={a} onChange={e => setSide('a', e.target.value)}>{list.map(opt)}</select>
        {mode === 'pair' && <><span style={{color:B_COL}}>B</span>
        <select style={sel} value={b} onChange={e => setSide('b', e.target.value)}>{list.map(opt)}</select></>}
        <label style={{color:C.textDim,cursor:'pointer'}} title="List every map and table, not only the ones that differ">
          <input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> ALL MAPS
        </label>
        <button style={btn(!busy && a && (b || mode === 'variants'))} disabled={busy || !a || (mode === 'pair' && !b)}
                onClick={mode === 'pair' ? run : runVariants}>{busy ? 'COMPARING…' : 'COMPARE'}</button>
        <span style={{flex:1}} />
        <button style={btn(false)} onClick={onClose}>✕</button>
      </div>
      {err && <div style={{color:C.red,marginTop:'6px',whiteSpace:'pre-wrap'}}>{err}</div>}
      {mode === 'variants' && vres && <VariantsTable v={vres} all={all} openPair={openPair} />}
      {mode === 'pair' && res && (
        <div style={{marginTop:'8px'}}>
          <div style={{color:C.textDim,marginBottom:'6px'}}>
            <span style={{color:A_COL}}>A</span> {res.a.name} <span style={{color:'#557755'}}>sha {res.a.sha}</span>
            {'  ·  '}<span style={{color:B_COL}}>B</span> {res.b.name} <span style={{color:'#557755'}}>sha {res.b.sha}</span>
            {'  ·  '}
            {res.identical
              ? <span style={{color:C.textBright}}>identical</span>
              : <span style={{color:C.amber}}>{res.diff_bytes} byte{res.diff_bytes > 1 ? 's' : ''} differ: {changed.length} map{changed.length !== 1 ? 's' : ''}/table{changed.length !== 1 ? 's' : ''}, {res.code.length} other run{res.code.length !== 1 ? 's' : ''}</span>}
          </div>
          {res.calib.length > 0 && <>
            <div style={{...title,marginTop:'8px'}}>MAPS AND TABLES {all ? '' : '(those that differ)'}</div>
            {res.calib.map(e => <CalibEntry key={e.key} e={e} />)}
          </>}
          {res.code.length > 0 && <>
            <div style={{...title,marginTop:'10px'}}>CODE AND OTHER BYTES</div>
            {!(res.listing_a && res.listing_b) && <div style={{color:'#ccaa44',marginBottom:'4px'}}>
              No disassembly for {!res.listing_a && !res.listing_b ? 'either image' : !res.listing_a ? 'A' : 'B'}: the bytes are shown without labels.</div>}
            {res.code.map(r => <CodeRun key={r.start} r={r} />)}
          </>}
        </div>
      )}
    </div>
  );
}
