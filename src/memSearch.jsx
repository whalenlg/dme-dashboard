import { useState, useMemo } from "react";
import { searchMem } from "./memDefs.js";

// ─────────────────────────────────────────────────────────────────
//  Memory search box: find a DME iram / KLR ram byte (or a DME bit of the
//  bit-addressable area) by hex address or by name (searchMem in
//  memDefs.js). Used by the
//  Timeline tab's MEMORY PICKER and the live debugger's breakpoint
//  conditions.
// ─────────────────────────────────────────────────────────────────

const C = { border:'#0d2e0d', textDim:'#ccddcc', textBright:'#00ff80', blue:'#44aaff' };
const hx = v => v.toString(16).toUpperCase().padStart(2, '0');

// Search box with a drop-down of matches. onPick(match, byKey) on a click or
// Enter on a highlighted match; onEnter() on Enter with nothing highlighted.
// search: q => matches, in place of the memory search (the Timeline's map
// pickers); a match with a tag shows that in place of the hex address, and
// one with logged: false is dimmed.
export function MemSearch({ src, value, onChange, onPick, onEnter, style, placeholder = 'search name or hex addr',
                            align = 'right', autoFocus, search }) {
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(0);
  const matches = useMemo(() => search ? search(value) : searchMem(src, value), [src, value, search]);
  const onKey = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHl(h => Math.min(h + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHl(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'Enter') {
      const m = open ? matches[hl] : null;
      setOpen(false); setHl(0);
      if (m) onPick(m, true); else onEnter?.();
    }
  };
  return (
    <span style={{position:'relative'}}>
      <input value={value} placeholder={placeholder} autoFocus={autoFocus}
             onChange={e => { onChange(e.target.value); setOpen(true); setHl(0); }}
             onFocus={() => setOpen(true)}
             onBlur={() => setTimeout(() => setOpen(false), 150)}
             onKeyDown={onKey} style={style} />
      {open && matches.length > 0 && (
        <div style={{position:'absolute',top:'100%',[align]:0,zIndex:20,minWidth:'320px',maxWidth:'460px',
                     background:'#030803',border:`1px solid ${C.border}`,boxShadow:'0 4px 12px #000a',textAlign:'left'}}>
          {matches.map((m, i) => (
            <div key={m.id ?? `${m.addr}_${m.bit ?? ''}`}
                 onMouseDown={e => { e.preventDefault(); setOpen(false); setHl(0); onPick(m, false); }}
                 onMouseEnter={() => setHl(i)}
                 title={m.logged === false ? `${m.desc ?? ""} (no lookups in this log)`.trim() : m.desc}
                 style={{padding:'3px 6px',cursor:'pointer',fontSize:'10px',display:'flex',gap:'8px',
                         background:i === hl ? '#0d2e0d' : 'transparent',opacity:m.logged === false ? 0.5 : 1}}>
              <span style={{color:C.blue,minWidth:'42px',whiteSpace:'nowrap'}}>{m.tag ?? `${hx(m.addr)}h${m.bit != null ? `.${m.bit}` : ''}`}</span>
              <span style={{color:C.textBright}}>{m.name}</span>
              <span style={{color:C.textDim,opacity:0.7,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.desc}</span>
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
