import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";

// ─────────────────────────────────────────────────────────────────
//  POP-OUT WINDOWS (live mode)
//  Each tab and each code debugger can open in a browser window of its
//  own. The window is a blank same-origin popup that this page renders
//  into through a React portal, so it shares this page's state (and the
//  one bridge connection) instead of running a second copy of the app.
//  Closing the window unmounts its content; reloading or leaving this
//  page closes them all.
// ─────────────────────────────────────────────────────────────────

// The window a component is rendered in (for key handlers and the like)
export const WinContext = createContext(window);
export const useWin = () => useContext(WinContext);

export const POPOUT_BG = '#040a04';

// Copy this page's stylesheets (index.css, the Google fonts) into a popup
function setUpDoc(win, title) {
  const doc = win.document;
  // Write a whole document rather than adding to the popup's initial
  // about:blank one: some browsers (Safari, Firefox) replace that one once
  // it "finishes loading", or don't give it a head and body yet, which left
  // the window blank. This also starts over a window left under this name
  // (e.g. from before a reload).
  doc.open();
  doc.write('<!doctype html><html><head><meta charset="utf-8"><title></title></head><body></body></html>');
  doc.close();
  doc.title = title;
  for (const n of document.querySelectorAll('style, link[rel="stylesheet"]')) {
    const c = doc.importNode(n, true);
    if (n.href) c.href = n.href;   // absolute, whatever the popup's base URL
    doc.head.appendChild(c);
  }
  doc.body.style.margin = '0';
  doc.body.style.background = POPOUT_BG;
  const el = doc.createElement('div');
  doc.body.appendChild(el);
  return el;
}

// Charts size themselves with a ResizeObserver made from this window's
// global, and one only sees layout in its own document. This stand-in
// hands each element to an observer from the element's own window, so
// charts in a pop-out follow its size too.
const NativeRO = window.ResizeObserver;
class AnyDocResizeObserver {
  constructor(cb) { this.cb = cb; this.obs = new Map(); }
  observe(el, opts) {
    // (this window's own global is this class once patched: use the real one)
    const own = el?.ownerDocument?.defaultView?.ResizeObserver;
    const RO = !own || own === AnyDocResizeObserver ? NativeRO : own;
    let o = this.obs.get(RO);
    if (!o) { o = new RO(entries => this.cb(entries, this)); this.obs.set(RO, o); }
    o.observe(el, opts);
  }
  unobserve(el) { for (const o of this.obs.values()) o.unobserve(el); }
  disconnect() { for (const o of this.obs.values()) o.disconnect(); this.obs.clear(); }
}
function patchResizeObserver() {
  if (NativeRO && window.ResizeObserver === NativeRO) window.ResizeObserver = AnyDocResizeObserver;
}

// name → { win, el }; open() must be called from a click handler so the
// browser lets the popup through
export function usePopouts() {
  const [wins, setWins] = useState({});
  const ref = useRef(wins);
  useEffect(() => { ref.current = wins; }, [wins]);

  const drop = useCallback((name, win) => setWins(ws => {
    if (ws[name]?.win !== win) return ws;
    const n = { ...ws };
    delete n[name];
    return n;
  }), []);

  // (Re)build a popup's document and render into it
  const attach = useCallback((name, win, title) => {
    const el = setUpDoc(win, title);
    // pagehide also fires when a document is replaced: only a closed window is gone
    win.addEventListener('pagehide', () => setTimeout(() => { if (win.closed) drop(name, win); }, 100));
    const entry = { win, el, title };
    ref.current = { ...ref.current, [name]: entry };
    setWins(ws => ({ ...ws, [name]: entry }));
  }, [drop]);

  const open = useCallback((name, title, w = 1180, h = 900) => {
    const cur = ref.current[name];
    if (cur && !cur.win.closed) { cur.win.focus(); return true; }
    const win = window.open('', `dme951-${name}`, `popup=yes,width=${w},height=${h}`);
    if (!win) {
      alert('The browser blocked the pop-up window. Allow pop-ups for this page to open tabs in their own windows.');
      return false;
    }
    patchResizeObserver();
    try {
      attach(name, win, title);
    } catch (e) {
      alert(`Couldn't set up the ${title} window: ${e.message}`);
      win.close();
      return false;
    }
    win.focus();
    return true;
  }, [attach]);

  const close = useCallback(name => { ref.current[name]?.win.close(); }, []);
  const closeAll = useCallback(() => { for (const w of Object.values(ref.current)) w.win.close(); }, []);

  // pagehide doesn't fire in every browser when a popup is closed: check
  // too, and set a window up again if the browser swapped its document out
  // from under the content
  useEffect(() => {
    const id = setInterval(() => {
      for (const [name, w] of Object.entries(ref.current)) {
        if (w.win.closed) drop(name, w.win);
        else if (!w.el.isConnected || w.el.ownerDocument !== w.win.document) {
          try { attach(name, w.win, w.title); } catch { /* try again next tick */ }
        }
      }
    }, 250);
    window.addEventListener('pagehide', closeAll);
    return () => { clearInterval(id); window.removeEventListener('pagehide', closeAll); };
  }, [drop, closeAll, attach]);

  return { wins, open, close, closeAll };
}

