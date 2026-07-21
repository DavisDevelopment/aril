// glcharts/core/viewport.js — PURE viewport + scale math (no DOM, no GL; node-testable).
//
// Mental model mirrors ChartCore/klinecharts so a future engine-swap adapter is mechanical:
//   x axis  — bar-INDEX domain, right-anchored. `right` is the fractional bar index sitting at
//             the plot's right edge; `barSpace` is CSS px per bar slot. Pan = shift right,
//             zoom = scale barSpace about an anchor x.
//   y axis  — price domain auto-fit to the visible bars (plus padding), linear, or pinned
//             manually via setPriceRange.
// All px are CSS px; the GL/2D layers apply devicePixelRatio themselves.

export const MIN_BAR_SPACE = 0.5;
export const MAX_BAR_SPACE = 80;

export function createViewport() {
  return {
    width: 0,          // plot-area CSS px (excludes axis gutters)
    height: 0,
    barSpace: 8,
    right: 0,          // fractional bar index at the right edge
    rightOffsetBars: 2,// breathing room kept after the newest bar on fitContent
    priceMin: 0,
    priceMax: 1,
    autoPrice: true,
    logScale: false,   // logarithmic price axis (Classic parity)
  };
}

export function setSize(vp, width, height) {
  vp.width = Math.max(0, width);
  vp.height = Math.max(0, height);
}

/** Snap the view to the newest data (right-anchored), keeping current zoom. */
export function fitRight(vp, barCount) {
  vp.right = barCount - 1 + vp.rightOffsetBars;
}

/** Bars visible in the plot: fractional [from, to] index range (to == vp.right). */
export function visibleRange(vp) {
  const to = vp.right;
  const from = to - vp.width / Math.max(vp.barSpace, 1e-6);
  return { from, to };
}

export function indexToX(vp, i) {
  return vp.width - (vp.right - i) * vp.barSpace;
}

export function xToIndex(vp, x) {
  return vp.right - (vp.width - x) / Math.max(vp.barSpace, 1e-6);
}

export function priceToY(vp, p) {
  if (vp.logScale) {
    const lo = Math.log(Math.max(vp.priceMin, 1e-12));
    const hi = Math.log(Math.max(vp.priceMax, 1e-12));
    const span = hi - lo || 1;
    const lp = Math.log(Math.max(p, 1e-12));
    return vp.height * (1 - (lp - lo) / span);
  }
  const span = vp.priceMax - vp.priceMin || 1;
  return vp.height * (1 - (p - vp.priceMin) / span);
}

export function yToPrice(vp, y) {
  if (vp.logScale) {
    const lo = Math.log(Math.max(vp.priceMin, 1e-12));
    const hi = Math.log(Math.max(vp.priceMax, 1e-12));
    const span = hi - lo || 1;
    const t = 1 - y / Math.max(vp.height, 1e-6);
    return Math.exp(lo + t * span);
  }
  const span = vp.priceMax - vp.priceMin || 1;
  return vp.priceMin + (1 - y / Math.max(vp.height, 1e-6)) * span;
}

/** Pan by dx CSS px (positive = drag right = look at older data). */
export function panPx(vp, dx) {
  vp.right -= dx / Math.max(vp.barSpace, 1e-6);
}

/** Zoom by `factor` about the bar under CSS-px x (cursor-anchored). */
export function zoomAt(vp, factor, x) {
  const anchor = xToIndex(vp, x);
  vp.barSpace = clamp(vp.barSpace * factor, MIN_BAR_SPACE, MAX_BAR_SPACE);
  // keep the anchor bar under the cursor: solve right from indexToX(anchor) == x
  vp.right = anchor + (vp.width - x) / vp.barSpace;
}

/** Clamp panning so at least one bar stays on screen (no flying into the void forever). */
export function clampRight(vp, barCount) {
  const perScreen = vp.width / Math.max(vp.barSpace, 1e-6);
  const min = 1;                                  // newest edge can scroll ← until 1 bar remains
  const max = barCount - 1 + perScreen - 1;       // oldest edge until 1 bar remains
  vp.right = clamp(vp.right, min, Math.max(min, max));
}

/**
 * Auto-fit the price domain to bars visible in [from,to] (fractional indices).
 * `volumeFrac` reserves the bottom band for the volume histogram, so candles are padded
 * away from it. Returns false when nothing is visible (domain untouched).
 */
export function autoFitPrice(vp, bars, { padFrac = 0.08, volumeFrac = 0 } = {}) {
  if (!vp.autoPrice || !bars.length) return false;
  const { from, to } = visibleRange(vp);
  const i0 = Math.max(0, Math.floor(from));
  const i1 = Math.min(bars.length - 1, Math.ceil(to));
  if (i1 < i0) return false;
  let lo = Infinity, hi = -Infinity;
  for (let i = i0; i <= i1; i++) {
    const b = bars[i];
    if (b.l < lo) lo = b.l;
    if (b.h > hi) hi = b.h;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return false;
  if (vp.logScale) {
    // Log axis requires strictly positive domain
    lo = Math.max(lo, 1e-12);
    hi = Math.max(hi, lo * 1.0001);
    const logLo = Math.log(lo);
    const logHi = Math.log(hi);
    const span = (logHi - logLo) || 0.02;
    const pad = span * padFrac;
    const bottomPad = pad + span * (volumeFrac / Math.max(1e-6, 1 - volumeFrac));
    vp.priceMin = Math.exp(logLo - bottomPad);
    vp.priceMax = Math.exp(logHi + pad);
    return true;
  }
  const span = (hi - lo) || Math.abs(hi) * 0.02 || 1;
  const pad = span * padFrac;
  // extra bottom padding so the price series floats above the volume band
  const bottomPad = pad + span * (volumeFrac / Math.max(1e-6, 1 - volumeFrac));
  vp.priceMin = lo - bottomPad;
  vp.priceMax = hi + pad;
  return true;
}

/** "Nice" tick values covering [min,max] — classic 1/2/5×10^k ladder. */
export function niceTicks(min, max, targetCount = 6) {
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(span)) return [];
  const raw = span / Math.max(1, targetCount);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;
  const start = Math.ceil(min / step) * step;
  const out = [];
  for (let v = start; v <= max + step * 1e-9; v += step) out.push(round12(v));
  return out;
}

/**
 * Time-axis ticks for visible bars: picks a bar stride so labels are ≥ minLabelPx apart,
 * returns [{ i, t }] for integer bar indices inside the view. Label FORMATTING is the
 * overlay's job (it knows the resolution).
 */
export function timeTicks(vp, bars, minLabelPx = 72) {
  if (!bars.length || vp.barSpace <= 0) return [];
  const stride = Math.max(1, Math.ceil(minLabelPx / vp.barSpace));
  const { from, to } = visibleRange(vp);
  const i0 = Math.max(0, Math.floor(from));
  const i1 = Math.min(bars.length - 1, Math.ceil(to));
  const out = [];
  const start = Math.ceil(i0 / stride) * stride;
  for (let i = start; i <= i1; i += stride) out.push({ i, t: bars[i].t });
  return out;
}

/** Decimal places for a price level (mirrors charting/core/data.js pricePrecisionFor). */
export function pricePrecisionFor(lastPrice) {
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) return 2;
  if (lastPrice >= 1000) return 1;
  if (lastPrice >= 10) return 2;
  if (lastPrice >= 0.1) return 4;
  return 6;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round12 = (v) => Math.round(v * 1e12) / 1e12;
