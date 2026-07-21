// glcharts/interact/hitTest.js — PURE hit-testing (no DOM). Bar pick by x-slot, drawing pick
// by distance to geometry. All coords are plot-local CSS px.

import { indexToX, xToIndex, priceToY, yToPrice } from "../core/viewport.js";
import { TOOLS } from "../drawings/tools.js";
// dist helpers live in drawings/geom.js — re-exported here for callers that already import hitTest
export { distToSegment, distToHLine, distToRay } from "../drawings/geom.js";

/** Nearest bar index under plot-x, or -1 if empty / far outside the series. */
export function hitTestBar(vp, bars, plotX) {
  if (!bars.length) return -1;
  const i = Math.round(xToIndex(vp, plotX));
  if (i < 0 || i >= bars.length) return -1;
  // reject if the cursor is more than half a bar-slot away from the candle center
  const cx = indexToX(vp, i);
  if (Math.abs(cx - plotX) > Math.max(vp.barSpace * 0.55, 4)) return -1;
  return i;
}

/** Resolve a plot-local (x,y) to a data-space anchor { t, value, i }. Snaps x to the nearest bar.
 *  With { magnet:true }, snaps value to the nearest of the bar's O/H/L/C. */
export function plotToAnchor(vp, bars, plotX, plotY, { magnet = false } = {}) {
  if (!bars.length) return null;
  const i = Math.max(0, Math.min(bars.length - 1, Math.round(xToIndex(vp, plotX))));
  let value = yToPrice(vp, plotY);
  if (magnet) {
    const b = bars[i];
    let best = value, bestDy = Infinity;
    for (const p of [b.o, b.h, b.l, b.c]) {
      if (!Number.isFinite(p)) continue;
      const dy = Math.abs(priceToY(vp, p) - plotY);
      if (dy < bestDy) { bestDy = dy; best = p; }
    }
    value = best;
  }
  return { t: bars[i].t, value, i };
}

/** Project a drawing point {t,value} → plot-local {x,y}, using bars to resolve t→index. */
export function anchorToPlot(vp, bars, pt) {
  if (!pt || !bars.length) return null;
  // binary search for t (bars are ascending)
  let lo = 0, hi = bars.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t < pt.t) lo = mid + 1;
    else hi = mid;
  }
  // if exact miss, interpolate between neighbors so drawings stay continuous across gaps
  let i = lo;
  if (i > 0 && Math.abs(bars[i - 1].t - pt.t) < Math.abs(bars[i].t - pt.t)) i = i - 1;
  let x;
  if (i < bars.length - 1 && bars[i].t !== pt.t && bars[i + 1].t !== bars[i].t) {
    const a = bars[i], b = bars[i + 1];
    if (pt.t > a.t && pt.t < b.t) {
      const f = (pt.t - a.t) / (b.t - a.t);
      x = indexToX(vp, i + f);
    } else {
      x = indexToX(vp, i);
    }
  } else {
    x = indexToX(vp, i);
  }
  return { x, y: priceToY(vp, pt.value), i };
}

/**
 * Hit-test drawings. Returns { drawingId, handleIndex } where handleIndex is the point
 * index when within handleRadius of a handle, else -1 (body hit). Prefer handle hits.
 */
export function hitTestDrawing(vp, bars, drawings, plotX, plotY, {
  handleRadius = 8,
  lineSlop = 6,
} = {}) {
  let best = null;
  let bestDist = Infinity;

  for (let d = drawings.length - 1; d >= 0; d--) { // topmost first
    const drawing = drawings[d];
    const tool = TOOLS[drawing.name];
    if (!tool) continue;
    const pts = (drawing.points || [])
      .map((p) => anchorToPlot(vp, bars, p))
      .filter(Boolean);
    if (!pts.length) continue;

    // handle hits win
    for (let h = 0; h < pts.length; h++) {
      const dist = Math.hypot(pts[h].x - plotX, pts[h].y - plotY);
      if (dist <= handleRadius && dist < bestDist) {
        bestDist = dist;
        best = { drawingId: drawing.id, handleIndex: h, dist };
      }
    }
    if (best?.drawingId === drawing.id && best.handleIndex >= 0) continue;

    const bodyDist = tool.hitDistance(pts, plotX, plotY, vp);
    if (bodyDist <= lineSlop && bodyDist < bestDist) {
      bestDist = bodyDist;
      best = { drawingId: drawing.id, handleIndex: -1, dist: bodyDist };
    }
  }
  return best;
}
