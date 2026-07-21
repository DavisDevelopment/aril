// glcharts/series/synesthesia.js — PURE sensory mappings for hard-to-see market details.
// Master toggle: GlChart.synesthesia. This module only computes frame state + geometry helpers.
//
// Mappings:
//   vol        → temperature (cool↔warm) + haze + heartbeat amplitude + mist
//   volume     → mass (line weight / pulse inertia)
//   regime     → brief "key change" flash when rolling drift flips sign
//   provenance → softness (mid_as_ohlc / flat OHLC feels velvety)
//   drawdown   → gravity well (underwater fill toward rolling peak)
//   skew       → lub/dub heartbeat asymmetry (downside-heavy → heavier dub)
//   localVol   → per-bar amp along the stroke (hotspots shimmer harder)

import { visibleRange } from "../core/viewport.js";
import { heartbeatIntensity } from "./volatility.js";

/**
 * @returns synesthesia frame state
 */
export function computeSynesthesia(vp, bars, prev = null, dtSec = 1 / 60) {
  const vol = heartbeatIntensity(vp, bars);
  const mass = volumeMass(vp, bars);
  const soft = provenanceSoftness(bars);
  const regimeNow = regimeSign(vp, bars);
  const skew = returnSkew(vp, bars);
  const { depth: ddDepth, peakFrac } = drawdownStats(vp, bars);

  const prevTemp = prev?.temp ?? vol;
  const temp = lerp(prevTemp, vol, 1 - Math.exp(-dtSec * 2.2));
  const haze = smoothstep((vol - 0.35) / 0.55);
  const mist = haze * 0.55 + ddDepth * 0.35;

  let regimeFlash = Math.max(0, (prev?.regimeFlash ?? 0) - dtSec * 1.6);
  if (prev && prev.regimeSign != null && regimeNow != null && prev.regimeSign !== regimeNow) {
    regimeFlash = 1;
  }

  const periodScale = 0.75 + mass * 0.85;

  return {
    vol,
    temp,
    mass,
    haze,
    mist,
    regimeFlash,
    soft,
    periodScale,
    skew,          // -1..+1  (neg = downside-heavy)
    ddDepth,       // 0..1 visible underwater depth
    peakFrac,      // share of bars below peak
    regimeSign: regimeNow,
  };
}

/** Relative volume vs median in the visible window. */
export function volumeMass(vp, bars) {
  if (!bars?.length) return 0.4;
  const { from, to } = visibleRange(vp);
  const i0 = Math.max(0, Math.floor(from));
  const i1 = Math.min(bars.length - 1, Math.ceil(to));
  if (i1 <= i0) return 0.4;
  const vols = [];
  for (let i = i0; i <= i1; i++) {
    const v = bars[i].v;
    if (Number.isFinite(v) && v >= 0) vols.push(v);
  }
  if (vols.length < 4) return 0.4;
  vols.sort((a, b) => a - b);
  const med = vols[vols.length >> 1] || 1;
  const recent = bars[i1]?.v ?? med;
  const ratio = recent / Math.max(med, 1e-9);
  return clamp(smoothstep((Math.log(ratio) + 0.7) / 1.6), 0.08, 1);
}

export function provenanceSoftness(bars, tail = 40) {
  if (!bars?.length) return 0;
  const start = Math.max(0, bars.length - tail);
  let soft = 0;
  let n = 0;
  for (let i = start; i < bars.length; i++) {
    const b = bars[i];
    n++;
    if (b.provenance === "mid_as_ohlc") { soft++; continue; }
    if (b.o === b.h && b.h === b.l && b.l === b.c) soft++;
  }
  return n ? soft / n : 0;
}

export function regimeSign(vp, bars) {
  if (!bars || bars.length < 10) return null;
  const { from, to } = visibleRange(vp);
  const i1 = Math.min(bars.length - 1, Math.ceil(to));
  const i0 = Math.max(0, Math.min(i1 - 1, Math.floor(from)));
  const win = Math.min(24, i1 - i0);
  if (win < 6) return null;
  const a = bars[i1 - win]?.c;
  const b = bars[i1]?.c;
  if (!(a > 0) || !(b > 0)) return null;
  const r = Math.log(b / a);
  if (!Number.isFinite(r) || Math.abs(r) < 1e-5) return null;
  return r >= 0 ? 1 : -1;
}

/** Skew of log-returns in the visible window → roughly -1..+1. */
export function returnSkew(vp, bars) {
  if (!bars || bars.length < 12) return 0;
  const { from, to } = visibleRange(vp);
  let i0 = Math.max(1, Math.floor(from));
  let i1 = Math.min(bars.length - 1, Math.ceil(to));
  if (i1 - i0 < 8) return 0;
  const rs = [];
  for (let i = i0; i <= i1; i++) {
    const a = bars[i - 1]?.c, b = bars[i]?.c;
    if (!(a > 0) || !(b > 0)) continue;
    const r = Math.log(b / a);
    if (Number.isFinite(r)) rs.push(r);
  }
  if (rs.length < 8) return 0;
  const mean = rs.reduce((s, x) => s + x, 0) / rs.length;
  let m2 = 0, m3 = 0;
  for (const r of rs) {
    const d = r - mean;
    m2 += d * d;
    m3 += d * d * d;
  }
  m2 /= rs.length;
  m3 /= rs.length;
  if (m2 < 1e-14) return 0;
  const skew = m3 / Math.pow(m2, 1.5);
  return clamp(skew / 2.5, -1, 1);
}

/** Max underwater depth + fraction of visible bars below their running peak. */
export function drawdownStats(vp, bars) {
  if (!bars?.length) return { depth: 0, peakFrac: 0 };
  const { from, to } = visibleRange(vp);
  const i0 = Math.max(0, Math.floor(from));
  const i1 = Math.min(bars.length - 1, Math.ceil(to));
  let peak = -Infinity;
  let maxDd = 0;
  let under = 0;
  let n = 0;
  // Seed peak from a bit of history so the well doesn't start empty.
  const seed0 = Math.max(0, i0 - 40);
  for (let i = seed0; i < i0; i++) {
    const c = bars[i]?.c;
    if (c > peak) peak = c;
  }
  for (let i = i0; i <= i1; i++) {
    const c = bars[i]?.c;
    if (!Number.isFinite(c)) continue;
    if (c > peak) peak = c;
    n++;
    const dd = peak > 0 ? (peak - c) / peak : 0;
    if (dd > 1e-6) under++;
    if (dd > maxDd) maxDd = dd;
  }
  return {
    depth: clamp(maxDd / 0.12, 0, 1), // 12% drawdown → full well
    peakFrac: n ? under / n : 0,
  };
}

/**
 * Per-bar local vol (rolling |log return| window), normalized 0..1 across the series.
 * Used as a vertex attribute so hotspots along the line shimmer harder.
 */
export function buildLocalVol(bars, window = 8) {
  const n = bars.length;
  const out = new Float32Array(n);
  if (n < 2) return out;
  const raw = new Float32Array(n);
  let max = 0;
  for (let i = 0; i < n; i++) {
    let sum = 0, cnt = 0;
    const a0 = Math.max(1, i - window + 1);
    for (let j = a0; j <= i; j++) {
      const a = bars[j - 1]?.c, b = bars[j]?.c;
      if (!(a > 0) || !(b > 0)) continue;
      sum += Math.abs(Math.log(b / a));
      cnt++;
    }
    raw[i] = cnt ? sum / cnt : 0;
    if (raw[i] > max) max = raw[i];
  }
  const denom = max > 1e-9 ? max : 1;
  for (let i = 0; i < n; i++) out[i] = raw[i] / denom;
  return out;
}

/**
 * Gravity-well strip: for each bar, verts at close and at running peak.
 * Layout per vertex: [idx, price, kind, dd] — kind 0 = close, 1 = peak; dd = underwater depth 0..1.
 * Draw as TRIANGLE_STRIP, 2n verts.
 */
export function buildGravityWellStrip(bars) {
  const n = bars.length;
  const out = new Float32Array(n * 2 * 4);
  let peak = -Infinity;
  let k = 0;
  for (let i = 0; i < n; i++) {
    const c = bars[i].c;
    if (c > peak) peak = c;
    const dd = peak > 0 ? clamp((peak - c) / peak / 0.12, 0, 1) : 0;
    out[k++] = i; out[k++] = c;    out[k++] = 0; out[k++] = dd;
    out[k++] = i; out[k++] = peak; out[k++] = 1; out[k++] = dd;
  }
  return out;
}

/** Mix cool→warm RGB (0..1) by temperature. */
export function temperatureColor(coolRgb, warmRgb, temp) {
  const t = clamp(temp, 0, 1);
  return [
    lerp(coolRgb[0], warmRgb[0], t),
    lerp(coolRgb[1], warmRgb[1], t),
    lerp(coolRgb[2], warmRgb[2], t),
  ];
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
function smoothstep(x) {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}
