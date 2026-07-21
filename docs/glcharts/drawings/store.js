// glcharts/drawings/store.js — drawing list + serialize/restore. Pure; no DOM.
// Point anchors are { t: unixSec, value: price } — timestamp-stable across history reloads
// (same contract as charting/core/drawings.js, seconds instead of ms).

import { TOOLS, pointsNeeded } from "./tools.js";

let _seq = 0;
const nextId = () => `d_${Date.now().toString(36)}_${(++_seq).toString(36)}`;

export function createDrawing(name, points = [], styles = null) {
  if (!TOOLS[name]) throw new Error(`unknown drawing tool: ${name}`);
  const d = { id: nextId(), name, points: points.map(clonePt) };
  if (styles && typeof styles === "object") d.styles = { ...styles };
  return d;
}

export function serializeDrawings(drawings) {
  if (!Array.isArray(drawings)) return [];
  return drawings
    .filter((d) => d && TOOLS[d.name] && Array.isArray(d.points) && d.points.length >= pointsNeeded(d.name))
    .map((d) => {
      const out = {
        id: d.id,
        name: d.name,
        points: d.points.map(clonePt),
      };
      if (d.styles) out.styles = { ...d.styles };
      return out;
    });
}

export function deserializeDrawings(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const d of raw) {
    if (!d || !TOOLS[d.name]) continue;
    if (!Array.isArray(d.points) || d.points.length < pointsNeeded(d.name)) continue;
    if (!d.points.every(isPt)) continue;
    const item = {
      id: typeof d.id === "string" ? d.id : nextId(),
      name: d.name,
      points: d.points.map(clonePt),
    };
    if (d.styles && typeof d.styles === "object") item.styles = { ...d.styles };
    out.push(item);
  }
  return out;
}

function isPt(p) {
  return p && Number.isFinite(p.t) && Number.isFinite(p.value);
}
function clonePt(p) {
  return { t: +p.t, value: +p.value };
}
