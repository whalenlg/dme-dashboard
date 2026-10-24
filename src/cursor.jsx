import { createContext, useContext } from "react";
import { useXAxisScale, usePlotArea } from "recharts";

// ─────────────────────────────────────────────────────────────────
//  PLAYBACK CURSOR
//  The scrubber time reaches charts through context, and <CursorLine>
//  draws it inside a chart. Moving the cursor (playback steps every
//  100 ms) then redraws only these lines, not every chart around them.
// ─────────────────────────────────────────────────────────────────

export const CursorContext = createContext(null);

export function CursorLine({ stroke, strokeWidth = 1, strokeDasharray }) {
  const t = useContext(CursorContext);
  const x = useXAxisScale();
  const area = usePlotArea();
  if (t == null || !x || !area) return null;
  const px = x(t);
  if (px == null || px < area.x || px > area.x + area.width) return null;
  return <line x1={px} x2={px} y1={area.y} y2={area.y + area.height} stroke={stroke}
               strokeWidth={strokeWidth} strokeDasharray={strokeDasharray} pointerEvents="none" />;
}
