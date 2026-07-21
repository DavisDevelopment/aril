// glcharts/drawings/geom.js — shared 2D distance helpers (no imports; breaks hitTest↔tools cycle).

export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function distToHLine(py, y) {
  return Math.abs(py - y);
}

export function distToRay(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(px - ax, py - ay);
  const t = ((px - ax) * dx + (py - ay) * dy) / len2;
  if (t < 0) return Math.hypot(px - ax, py - ay);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
