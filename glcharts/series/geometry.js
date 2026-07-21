// glcharts/series/geometry.js — PURE geometry builders (no GL; node-testable).
// These turn Bar[] into the typed-array layouts the series shaders consume. Buffers depend only
// on the DATA, never the viewport — pan/zoom is uniforms-only by design.

/** Sort ascending by t and dedup (last write wins), dropping malformed rows. Same contract as
 *  charting/core/data.js normalizeBars — duplicated so glcharts stays a standalone library. */
export function normalizeBars(bars) {
  const byT = new Map();
  for (const b of bars || []) {
    if (!b || !Number.isFinite(b.t) || !Number.isFinite(b.c)) continue;
    const row = {
      t: b.t,
      o: Number.isFinite(b.o) ? +b.o : +b.c,
      h: Number.isFinite(b.h) ? +b.h : +b.c,
      l: Number.isFinite(b.l) ? +b.l : +b.c,
      c: +b.c,
      v: Number.isFinite(b.v) ? +b.v : 0,
    };
    // Preserve soft-bar provenance so sensory clarity / reception stay honest.
    if (typeof b.provenance === "string" && b.provenance) row.provenance = b.provenance;
    byT.set(b.t, row);
  }
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

/**
 * Candle instance buffer: one instance per bar, layout [idx, o, h, l, c] (stride 5 floats).
 * The same buffer feeds the body pass (o→c rect) and the wick pass (l→h rect); the shader's
 * u_mode uniform picks the rect, and direction (c>=o) is derived in-shader.
 */
export function buildCandleInstances(bars) {
  const out = new Float32Array(bars.length * 5);
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i], k = i * 5;
    out[k] = i;
    out[k + 1] = b.o;
    out[k + 2] = b.h;
    out[k + 3] = b.l;
    out[k + 4] = b.c;
  }
  return out;
}

/**
 * Volume instance buffer: [idx, v, dir] (stride 3). Also returns vMax for the band scale.
 * dir is +1 (up / c>=o) or -1 so the shader can tint without re-deriving from OHLC.
 */
export function buildVolumeInstances(bars) {
  const out = new Float32Array(bars.length * 3);
  let vMax = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i], k = i * 3;
    out[k] = i;
    out[k + 1] = b.v;
    out[k + 2] = b.c >= b.o ? 1 : -1;
    if (b.v > vMax) vMax = b.v;
  }
  return { data: out, vMax: vMax || 1 };
}

/**
 * Polyline strip for a screen-space-constant-width line through (idx, close).
 * Each point emits 2 vertices; layout per vertex: [x, y, px, py, nx, ny, side] (stride 7):
 * current point, previous point, next point (all in data space), side ∈ {+1,-1}.
 * The vertex shader projects all three with live uniforms and extrudes along the miter normal,
 * so this buffer is static across pan/zoom. Draw as TRIANGLE_STRIP with 2n vertices.
 */
export function buildLineStrip(bars, value = (b) => b.c, localVol = null) {
  const n = bars.length;
  // stride 8: [x,y, px,py, nx,ny, side, localVol]
  const out = new Float32Array(n * 2 * 8);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const y = value(bars[i]);
    const pi = Math.max(0, i - 1);
    const ni = Math.min(n - 1, i + 1);
    const py = value(bars[pi]);
    const ny = value(bars[ni]);
    const lv = localVol ? localVol[i] : 0;
    for (const side of [1, -1]) {
      out[k++] = i;  out[k++] = y;
      out[k++] = pi; out[k++] = py;
      out[k++] = ni; out[k++] = ny;
      out[k++] = side;
      out[k++] = lv;
    }
  }
  return out;
}

/**
 * Area fill strip: per point, a vertex on the series line (kind 0) and one on the baseline
 * (kind 1). Layout [idx, value, kind] (stride 3); the shader puts kind-1 vertices at the plot
 * bottom and fades alpha from alphaTop→alphaBottom. Draw as TRIANGLE_STRIP with 2n vertices.
 */
export function buildAreaStrip(bars, value = (b) => b.c) {
  const n = bars.length;
  const out = new Float32Array(n * 2 * 3);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const y = value(bars[i]);
    out[k++] = i; out[k++] = y; out[k++] = 0;
    out[k++] = i; out[k++] = y; out[k++] = 1;
  }
  return out;
}
