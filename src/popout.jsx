import { createPortal } from "react-dom";
import { WinContext, POPOUT_BG } from "./popouts.js";

// (usePopouts and the window context are in popouts.js)
// Render children into an open popup (an entry of usePopouts().wins):
// the main page's font and colours, a title bar, the children in a
// scrolling area, and an optional footer (a scrubber) pinned below it.
export function Popout({ entry, title, sub, footer, children }) {
  if (!entry) return null;
  return createPortal(
    <WinContext.Provider value={entry.win}>
      <div style={{background:POPOUT_BG,color:'#00e060',fontFamily:"'Share Tech Mono','Courier New',monospace",fontSize:'12px',
                   height:'100vh',display:'flex',flexDirection:'column',textAlign:'center'}}>
        <div style={{background:'#060e06',borderBottom:'2px solid #0d2e0d',padding:'6px 14px',flexShrink:0,
                     display:'flex',alignItems:'baseline',gap:'12px'}}>
          <div style={{fontFamily:"'Orbitron','Courier New',monospace",fontSize:'13px',fontWeight:900,color:'#00ff80',
                       letterSpacing:'0.08em',textShadow:'0 0 12px #00ff8066'}}>▶ {title}</div>
          {sub && <span style={{color:'#66ddaa',fontSize:'10px'}}>{sub}</span>}
        </div>
        <div style={{padding:'10px',flex:1,overflow:'auto'}}>{children}</div>
        {footer}
      </div>
    </WinContext.Provider>,
    entry.el);
}
