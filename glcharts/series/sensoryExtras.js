// glcharts/series/sensoryExtras.js — extra synesthesia layers (PURE builders + overlay FX).
// VWAP leash, H/L aurora envelope, volume bass-hits, sonic rings, phosphor afterglow.

import { visibleRange, indexToX, priceToY } from "../core/viewport.js";

/** Running VWAP series (typical price × volume / cum vol). */
export function buildVwap(bars) {
  if (!bars?.length) return new Float32Array(0);
  const n = bars.length;
  const out = new Float32Array(n);
  let pv = 0, vv = 0;
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    if (!b || !Number.isFinite(b.c)) {
      out[i] = i > 0 ? out[i - 1] : 0;
      continue;
    }
    const h = Number.isFinite(b.h) ? b.h : b.c;
    const l = Number.isFinite(b.l) ? b.l : b.c;
    const tp = (h + l + b.c) / 3;
    const v = Math.max(0, Number.isFinite(b.v) ? b.v : 0) || 1;
    pv += tp * v;
    vv += v;
    out[i] = vv > 0 ? pv / vv : b.c;
  }
  return out;
}

/**
 * Aurora strip: high/low envelope. Layout [idx, hi, lo] per point (stride 3),
 * expanded to triangle strip in the series (2 verts: hi + lo).
 */
export function buildAuroraStrip(bars) {
  if (!bars?.length) return new Float32Array(0);
  const n = bars.length;
  const out = new Float32Array(n * 2 * 3);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    const c = Number.isFinite(b?.c) ? b.c : 0;
    const h = Number.isFinite(b?.h) ? b.h : c;
    const l = Number.isFinite(b?.l) ? b.l : c;
    out[k++] = i; out[k++] = h; out[k++] = 0; // hi edge
    out[k++] = i; out[k++] = l; out[k++] = 1; // lo edge
  }
  return out;
}

/**
 * VWAP leash springs for the last `tail` bars: each is a 2-point segment close→vwap.
 * Returns Float32Array of [idx, price] pairs.
 */
export function buildVwapLeash(bars, vwap, tail = 48) {
  if (!bars?.length || !vwap?.length) return { data: new Float32Array(0), count: 0 };
  const n = Math.min(bars.length, vwap.length);
  const start = Math.max(0, n - Math.max(1, tail | 0));
  const count = n - start;
  const out = new Float32Array(count * 4); // 2 verts × 2 floats
  let k = 0;
  for (let i = start; i < n; i++) {
    const c = Number.isFinite(bars[i]?.c) ? bars[i].c : vwap[i];
    const w = Number.isFinite(vwap[i]) ? vwap[i] : c;
    out[k++] = i; out[k++] = c;
    out[k++] = i; out[k++] = w;
  }
  return { data: out, count: count * 2 };
}

/** Detect volume bass-hits in visible window; merge with decaying previous hits. */
export function updateBassHits(vp, bars, prevHits = [], nowSec = 0) {
  const alive = (prevHits || []).filter((h) =>
    h && Number.isFinite(h.born) && nowSec - h.born < 1.4);
  if (!bars?.length || !vp) return alive;
  const { from, to } = visibleRange(vp);
  const i0 = Math.max(0, Math.floor(from));
  const i1 = Math.min(bars.length - 1, Math.ceil(to));
  if (i1 < i0) return alive;
  const vols = [];
  for (let i = i0; i <= i1; i++) {
    const v = bars[i]?.v;
    if (Number.isFinite(v) && v >= 0) vols.push(v);
  }
  if (vols.length < 8) return alive;
  const sorted = [...vols].sort((a, b) => a - b);
  const med = sorted[sorted.length >> 1] || 1;
  const existing = new Set(alive.map((h) => h.i));
  // Only consider the newest few bars so we don't re-fire history every frame
  const scan0 = Math.max(i0, i1 - 3);
  for (let i = scan0; i <= i1; i++) {
    const b = bars[i];
    if (!b) continue;
    const v = b.v;
    if (!(v > med * 2.2) || existing.has(i)) continue;
    // Range expansion confirms the hit isn't empty volume noise
    const prev = bars[i - 1];
    const range = Number.isFinite(b.h) && Number.isFinite(b.l) ? (b.h - b.l) : 0;
    const prevRange = prev && Number.isFinite(prev.h) && Number.isFinite(prev.l)
      ? Math.max(1e-12, prev.h - prev.l) : range || 1e-12;
    const rangeBoost = range > prevRange * 1.15 ? 0.15 : 0;
    const strength = Math.min(1, (v / med - 2.2) / 3 + rangeBoost);
    const price = Number.isFinite(b.c) ? b.c : (Number.isFinite(b.h) ? b.h : 0);
    alive.push({ i, born: nowSec, strength, price });
  }
  return alive;
}

/** Spawn / decay a sonic ring from the last bar when |return| is large. */
export function updateSonicRing(bars, prev, nowSec) {
  if (!bars?.length) return prev && nowSec - prev.born < 1.2 ? prev : null;
  const last = bars[bars.length - 1];
  const prevBar = bars[bars.length - 2];
  if (!prevBar || !(prevBar.c > 0) || !(last?.c > 0)) {
    return prev && nowSec - prev.born < 1.2 ? prev : null;
  }
  const ret = Math.abs(Math.log(last.c / prevBar.c));
  // Volume confirmation: impulse with rising volume hits harder
  const volRatio = (Number.isFinite(last.v) && Number.isFinite(prevBar.v) && prevBar.v > 0)
    ? last.v / prevBar.v : 1;
  const shouldFire = ret > 0.012; // ~1.2% bar move
  if (shouldFire && (!prev || nowSec - prev.born > 0.85 || prev.i !== bars.length - 1)) {
    const volBoost = Math.min(0.25, Math.max(0, (volRatio - 1) * 0.12));
    return {
      i: bars.length - 1,
      born: nowSec,
      strength: Math.min(1, ret / 0.04 + volBoost),
      price: last.c,
    };
  }
  if (prev && nowSec - prev.born < 1.2) return prev;
  return null;
}

/** Paint overlay FX: bass hits, sonic ring, phosphor afterglow on newest bars. */
export function paintSensoryOverlay(ctx, {
  vp, bars, plot, theme, syn, nowSec = 0,
}) {
  if (!syn || !bars?.length || !plot?.w) return;
  const tok = theme.synesthesia || {};
  const preset = syn.preset || {};
  const motion = syn.motionTier === "minimal" ? 0 : (preset.motion ?? 1);
  const flash = preset.flash ?? 1;
  if (motion < 0.05 && flash < 0.05) return;

  // Phosphor afterglow — newest bars leave a fading bloom scaled by local range
  const glowN = Math.min(10, bars.length);
  const gain = Math.max(0.15, motion);
  for (let k = 0; k < glowN; k++) {
    const i = bars.length - 1 - k;
    const b = bars[i];
    if (!b || !Number.isFinite(b.c)) continue;
    const x = plot.x + indexToX(vp, i);
    if (x < plot.x - 20 || x > plot.x + plot.w + 20) continue;
    const h = Number.isFinite(b.h) ? b.h : b.c;
    const l = Number.isFinite(b.l) ? b.l : b.c;
    const yH = plot.y + priceToY(vp, h);
    const yL = plot.y + priceToY(vp, l);
    const age = k / glowN;
    const rangeFrac = b.c > 0 ? Math.min(1, (h - l) / b.c / 0.02) : 0;
    const a = (1 - age) * (0.08 + 0.10 * clamp01(syn.vol) + 0.06 * rangeFrac) * gain;
    if (a < 0.01) continue;
    ctx.fillStyle = `rgba(255, 200, 140, ${a.toFixed(3)})`;
    const w = Math.max(2, vp.barSpace * 0.7);
    ctx.fillRect(x - w / 2, yH, w, Math.max(2, yL - yH));
  }

  // Bass hits — expanding soft discs at spike bars
  for (const hit of syn.bassHits || []) {
    if (!hit || !Number.isFinite(hit.born)) continue;
    const age = (nowSec - hit.born) / 1.4;
    if (age < 0 || age > 1) continue;
    const x = plot.x + indexToX(vp, hit.i);
    const y = plot.y + priceToY(vp, hit.price);
    const strength = clamp01(hit.strength);
    const r = 6 + age * 28 * (0.5 + strength) * gain;
    const a = (1 - age) * (0.18 + 0.35 * strength) * flash;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = (tok.warm || "#ff7a59");
    ctx.globalAlpha = a;
    ctx.lineWidth = 1.5 + strength;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Sonic ring from last impulsive bar
  const ring = syn.sonicRing;
  if (ring && Number.isFinite(ring.born)) {
    const age = (nowSec - ring.born) / 1.2;
    if (age >= 0 && age <= 1) {
      const x = plot.x + indexToX(vp, ring.i);
      const y = plot.y + priceToY(vp, ring.price);
      const r = 4 + age * 55 * (0.4 + clamp01(ring.strength)) * gain;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.strokeStyle = tok.regimeHue || "#c4a1ff";
      ctx.globalAlpha = (1 - age) * 0.55 * flash;
      ctx.lineWidth = 1.25;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}

function clamp01(x) {
  return Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
}
