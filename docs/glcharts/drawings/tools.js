// glcharts/drawings/tools.js — drawing-tool catalog. Point counts + geometry helpers used by
// hit-testing and the Canvas2D renderer. Names mirror klinecharts overlays so a ChartCore
// adapter can round-trip drawings later.

import { distToSegment, distToHLine, distToRay } from "./geom.js";

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

export const TOOLS = {
  segment: {
    label: "Trendline",
    pointsNeeded: 2,
    hitDistance(pts, x, y) {
      if (pts.length < 2) return Infinity;
      return distToSegment(x, y, pts[0].x, pts[0].y, pts[1].x, pts[1].y);
    },
  },
  horizontalStraightLine: {
    label: "H-Line",
    pointsNeeded: 1,
    hitDistance(pts, x, y) {
      if (!pts.length) return Infinity;
      return distToHLine(y, pts[0].y);
    },
  },
  rayLine: {
    label: "Ray",
    pointsNeeded: 2,
    hitDistance(pts, x, y) {
      if (pts.length < 2) return Infinity;
      return distToRay(x, y, pts[0].x, pts[0].y, pts[1].x, pts[1].y);
    },
  },
  rect: {
    label: "Rect",
    pointsNeeded: 2,
    hitDistance(pts, x, y) {
      if (pts.length < 2) return Infinity;
      const x0 = Math.min(pts[0].x, pts[1].x), x1 = Math.max(pts[0].x, pts[1].x);
      const y0 = Math.min(pts[0].y, pts[1].y), y1 = Math.max(pts[0].y, pts[1].y);
      // distance to the rectangle border (inside counts as a hit with dist 0)
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) {
        return Math.min(x - x0, x1 - x, y - y0, y1 - y);
      }
      const cx = Math.max(x0, Math.min(x1, x));
      const cy = Math.max(y0, Math.min(y1, y));
      return Math.hypot(x - cx, y - cy);
    },
  },
  fibonacciLine: {
    label: "Fib",
    pointsNeeded: 2,
    hitDistance(pts, x, y, vp) {
      if (pts.length < 2) return Infinity;
      let best = Infinity;
      for (const lvl of FIB_LEVELS) {
        const py = pts[0].y + (pts[1].y - pts[0].y) * lvl;
        best = Math.min(best, distToHLine(y, py));
      }
      // also the vertical connector between the two anchors
      best = Math.min(best, distToSegment(x, y, pts[0].x, pts[0].y, pts[1].x, pts[1].y));
      return best;
    },
  },
  verticalStraightLine: {
    label: "V-Line",
    pointsNeeded: 1,
    hitDistance(pts, x, y) {
      if (!pts.length) return Infinity;
      return Math.abs(x - pts[0].x);
    },
  },
  horizontalSegment: {
    label: "H-Seg",
    pointsNeeded: 2,
    hitDistance(pts, x, y) {
      if (pts.length < 2) return Infinity;
      const y0 = pts[0].y;
      const x0 = Math.min(pts[0].x, pts[1].x);
      const x1 = Math.max(pts[0].x, pts[1].x);
      if (x < x0 || x > x1) {
        return Math.min(
          Math.hypot(x - x0, y - y0),
          Math.hypot(x - x1, y - y0),
        );
      }
      return Math.abs(y - y0);
    },
  },
  parallelStraightLine: {
    label: "Channel",
    pointsNeeded: 3,
    hitDistance(pts, x, y) {
      if (pts.length < 2) return Infinity;
      let best = distToSegment(x, y, pts[0].x, pts[0].y, pts[1].x, pts[1].y);
      if (pts.length >= 3) {
        const dx = pts[1].x - pts[0].x;
        const dy = pts[1].y - pts[0].y;
        const p2 = { x: pts[2].x + dx, y: pts[2].y + dy };
        best = Math.min(best, distToSegment(x, y, pts[2].x, pts[2].y, p2.x, p2.y));
      }
      return best;
    },
  },
  abcd: {
    label: "ABCD",
    pointsNeeded: 4,
    hitDistance(pts, x, y) {
      if (pts.length < 2) return Infinity;
      let best = Infinity;
      for (let i = 0; i < pts.length - 1; i++) {
        best = Math.min(best, distToSegment(x, y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y));
      }
      return best;
    },
  },
  annotation: {
    label: "Note",
    pointsNeeded: 1,
    hitDistance(pts, x, y) {
      if (!pts.length) return Infinity;
      return Math.hypot(x - pts[0].x, y - pts[0].y);
    },
  },
};

export const TOOL_NAMES = Object.keys(TOOLS);

export function pointsNeeded(name) {
  return TOOLS[name]?.pointsNeeded ?? 0;
}
