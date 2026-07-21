// glcharts/series/barTransforms.js — PURE OHLCV re-derivations for chart types (no GL; testable).
//
// Each transform maps a normalized Bar[] ({t,o,h,l,c,v}, ascending t) to a new Bar[] the base
// candle drawer renders. Time-aligned transforms (Heikin-Ashi) keep 1:1 index/timestamp with the
// input so indicators/drawings/inspect line up; Renko is NOT time-aligned (price-bucketed bricks),
// so its descriptor sets timeAligned:false and every consumer operates on the brick series.

/**
 * Heikin-Ashi smoothing. haClose = ohlc/4; haOpen = prev (haOpen+haClose)/2 (seed = (o+c)/2);
 * haHigh/haLow extend to include haOpen/haClose. Keeps t and v — 1:1 with input.
 */
export function heikinAshi(bars) {
  const n = bars?.length || 0;
  const out = new Array(n);
  let prevOpen = 0, prevClose = 0;
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    const haClose = (b.o + b.h + b.l + b.c) / 4;
    const haOpen = i === 0 ? (b.o + b.c) / 2 : (prevOpen + prevClose) / 2;
    const haHigh = Math.max(b.h, haOpen, haClose);
    const haLow = Math.min(b.l, haOpen, haClose);
    out[i] = { t: b.t, o: haOpen, h: haHigh, l: haLow, c: haClose, v: b.v };
    if (b.provenance) out[i].provenance = b.provenance;
    prevOpen = haOpen;
    prevClose = haClose;
  }
  return out;
}

/** Wilder-ish mean true range (single scalar) — the default Renko box size when unspecified. */
export function meanTrueRange(bars, n = 14) {
  const len = bars?.length || 0;
  if (len < 2) return 0;
  let sum = 0, count = 0;
  for (let i = 1; i < len; i++) {
    const b = bars[i], p = bars[i - 1];
    const tr = Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c));
    if (Number.isFinite(tr)) { sum += tr; count++; }
  }
  const atr = count ? sum / count : 0;
  // A shorter tail biases toward recent volatility; blend lightly for stability.
  return atr || 0;
}

/**
 * Renko bricks. Emits a new brick every time close moves a full `box` from the last brick level.
 * Not time-aligned: brick count differs from input; each brick carries the timestamp of the bar
 * that completed it and the volume accumulated since the previous brick.
 *   box: absolute price per brick. Default = meanTrueRange(bars) (>0), clamped to a sane floor.
 */
export function renko(bars, { box } = {}) {
  const n = bars?.length || 0;
  if (n < 2) return [];
  let size = Number.isFinite(box) && box > 0 ? box : meanTrueRange(bars);
  if (!(size > 0)) {
    // Degenerate flat series: fall back to a small fraction of price so we still emit something.
    const ref = Math.abs(bars[0].c) || 1;
    size = ref * 0.005;
  }
  const out = [];
  let level = bars[0].c;          // last brick boundary
  let volAccum = 0;
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    volAccum += b.v || 0;
    // Up bricks
    while (b.c - level >= size) {
      const o = level, c = level + size;
      out.push({ t: b.t, o, h: c, l: o, c, v: volAccum });
      level = c;
      volAccum = 0;
    }
    // Down bricks
    while (level - b.c >= size) {
      const o = level, c = level - size;
      out.push({ t: b.t, o, h: o, l: c, c, v: volAccum });
      level = c;
      volAccum = 0;
    }
  }
  return out;
}

/** Named transform lookup used by the chart-type registry. */
export const BAR_TRANSFORMS = { heikinAshi, renko };
