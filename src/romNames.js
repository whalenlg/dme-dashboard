// Names of edited ROM images (see romEdits.jsx). Bytes edited in the code
// windows make an image named <name>.patch-<hash>.mem; it is shown by the
// name of the image it was made from, in red, with "(modified)".
export const MODIFIED = '#ff4444';
const PATCHED = /\.patch-[0-9a-f]{8}(\.mem)$/i;
export const fileOf = p => p ? String(p).split(/[\\/]/).pop() : '';
export const isEdited = p => PATCHED.test(fileOf(p));
// The name an image is shown by: an edited one by the image it was made from
export const shownName = p => fileOf(p).replace(PATCHED, '$1') || '--';
// As plain text (a <select> option, a tooltip)
export const nameText = p => `${shownName(p)}${isEdited(p) ? ' (modified)' : ''}`;

// Save an image as a raw .bin through the browser of the window the button is in
export async function downloadBin(e, bridge, cpu, name) {
  const doc = e.currentTarget.ownerDocument;
  try {
    const r = await fetch(`${bridge}/image/${cpu}.bin${name ? `?name=${encodeURIComponent(name)}` : ''}`);
    if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
    const file = r.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? `${cpu}.bin`;
    const a = doc.createElement('a');
    a.href = URL.createObjectURL(await r.blob());
    a.download = file;
    doc.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (err) {
    doc.defaultView.alert(`Couldn't download the .bin: ${err.message}`);
  }
}
