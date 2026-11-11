// ─────────────────────────────────────────────────────────────────
//  FOOTER — copyright and credits, at the bottom of the main page and
//  of every pop-out window
// ─────────────────────────────────────────────────────────────────

const LINKS = [
  'https://jhnbyrn.github.io',
  'https://sourceforge.net/p/opendme',
  'https://www.carpokes.com',
];

const link = { color:'#66ddaa', textDecoration:'none' };

export function Footer() {
  return (
    <footer style={{borderTop:'1px solid #0d2e0d',padding:'10px 14px 12px',color:'#779977',fontSize:'10px',
                    lineHeight:1.6,textAlign:'center',flexShrink:0}}>
      <div style={{color:'#ccddcc',letterSpacing:'0.15em',fontSize:'9px',marginBottom:'2px'}}>CREDITS</div>
      <div>
        This work is based on multiple public references, including{' '}
        {LINKS.map((u, i) => (
          <span key={u}>{i > 0 && ' '}<a href={u} target="_blank" rel="noopener noreferrer" style={link}>{u}</a></span>
        ))}
      </div>
      <div>Special thanks to users @tom and @johnb at Carpokes for their contributions and feedback during development.</div>
      <div style={{marginTop:'6px',color:'#ccddcc'}}>Copyright 2026 Michael Whalen. No affiliation with Dr. Ing. h.c. F. Porsche AG or any of its affiliates.</div>
    </footer>
  );
}
