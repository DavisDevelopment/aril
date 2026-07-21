// glcharts/series/sensoryPsionic.js — "psionic" sensory pack for pattern-attuned perception.
// Pure builders + overlay: precog shimmer, astral projection cone, intent beam,
// reception clarity (channel quality), pressure field arcs. Gated by synesthesia;
// gain follows sensory intensity (gentle = quiet channel, vivid = open third eye).

import { visibleRange, indexToX, priceToY } from "../core/viewport.js";

/**
 * Compute psionic frame metrics from bars (+ optional syn context for series-tied enrichment).
 * @returns {{ reception, precog, intent, field, precursors: Float32Array, projection }}
 */
export function computePsionic(vp, bars, prev = null, dtSec = 1 / 60, syn = null) {
  if (!bars?.length) {
    return {
      reception: 0.5, precog: 0, intent: 0, field: 0,
      precursors: new Float32Array(0), projection: null,
    };
  }
  const reception = receptionClarity(bars);
  const precursors = buildPrecursorScores(bars);
  const { from, to } = visibleRange(vp);
  const i1 = Math.min(bars.length - 1, Math.ceil(to));
  const i0 = Math.max(0, Math.floor(from));
  let precogPeak = 0;
  for (let i = Math.max(i0, i1 - 12); i <= i1; i++) {
    if (precursors[i] > precogPeak) precogPeak = precursors[i];
  }
  // Softness / low reception dampens perceived precog (noisy channel)
  precogPeak *= 0.55 + 0.45 * reception;

  let intent = empathicIntent(vp, bars);
  let field = pressureField(vp, bars);
  // Enrich with syn series state when present (skew / mass / drawdown)
  if (syn) {
    const skew = clamp(finiteOr(syn.skew, 0), -1, 1);
    const mass = clamp01(finiteOr(syn.mass, 0.4));
    const dd = clamp01(finiteOr(syn.ddDepth, 0));
    intent = clamp(intent * (0.7 + 0.3 * mass) + skew * 0.2, -1, 1);
    // Drawdown pressure pulls field negative (sinking feel)
    field = clamp(field - dd * 0.25, -1, 1);
  }

  const projection = buildAstralProjection(bars, 8);

  const ease = (key, next, rate = 2.4) => {
    const p = prev?.[key];
    if (p == null || !Number.isFinite(p)) return next;
    const t = 1 - Math.exp(-Math.max(0, dtSec) * rate);
    return lerp(p, next, clamp01(t));
  };

  return {
    reception: ease("reception", reception, 1.6),
    precog: ease("precog", precogPeak, 2.0),
    intent: ease("intent", intent, 2.2),
    field: ease("field", field, 2.0),
    precursors,
    projection,
  };
}

/** Channel quality: gaps / soft provenance / zero-volume runs → static; clean OHLC → clear. */
export function receptionClarity(bars, tail = 48) {
  if (!bars?.length) return 0.5;
  const start = Math.max(0, bars.length - Math.max(1, tail));
  let soft = 0, gaps = 0, zeroVol = 0, n = 0;
  let prevT = null;
  const dts = [];
  for (let i = start; i < bars.length; i++) {
    const b = bars[i];
    if (!b) continue;
    n++;
    if (b.provenance === "mid_as_ohlc" || (b.o === b.h && b.h === b.l && b.l === b.c)) soft++;
    if (!(b.v > 0)) zeroVol++;
    if (prevT != null && Number.isFinite(b.t)) dts.push(b.t - prevT);
    prevT = b.t;
  }
  if (!n) return 0.5;
  let gapFrac = 0;
  if (dts.length) {
    const s = [...dts].sort((a, b) => a - b);
    const dtMed = s[s.length >> 1] || 1;
    for (const d of dts) {
      if (d > dtMed * 2.5) gaps++;
    }
    gapFrac = gaps / dts.length;
  }
  const softFrac = soft / n;
  const zvFrac = zeroVol / n;
  return clamp01(1 - softFrac * 0.55 - gapFrac * 0.85 - zvFrac * 0.25);
}

/**
 * Precursor score per bar: local vol compression then a kick — classic "coiled spring".
 */
export function buildPrecursorScores(bars, win = 8) {
  const n = bars?.length || 0;
  const out = new Float32Array(n);
  if (n < win + 2) return out;
  const ranges = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    if (!b || !Number.isFinite(b.c)) { ranges[i] = 1e-12; continue; }
    const h = Number.isFinite(b.h) ? b.h : b.c;
    const l = Number.isFinite(b.l) ? b.l : b.c;
    ranges[i] = Math.max(1e-12, (h - l) / Math.max(Math.abs(b.c), 1e-9));
  }
  for (let i = win; i < n; i++) {
    let sum = 0;
    for (let k = i - win; k < i; k++) sum += ranges[k];
    const avg = sum / win;
    const coil = clamp01(1 - ranges[i] / Math.max(avg, 1e-9));
    let kick = 0;
    if (i + 1 < n && bars[i].c > 0 && bars[i + 1]?.c > 0) {
      kick = Math.min(1, Math.abs(Math.log(bars[i + 1].c / bars[i].c)) / 0.02);
    } else if (i > 0 && bars[i - 1]?.c > 0 && bars[i].c > 0) {
      kick = Math.min(1, Math.abs(Math.log(bars[i].c / bars[i - 1].c)) / 0.025);
    }
    // Volume coil: quiet volume before a kick is a stronger tingle
    const vNow = Number.isFinite(bars[i]?.v) ? bars[i].v : 0;
    let vAvg = 0;
    for (let k = i - win; k < i; k++) vAvg += Number.isFinite(bars[k]?.v) ? bars[k].v : 0;
    vAvg /= win;
    const volCoil = vAvg > 0 ? clamp01(1 - vNow / Math.max(vAvg, 1e-9)) : 0;
    const live = i >= n - 3;
    out[i] = live
      ? clamp01(coil * 0.7 + kick * 0.15 + volCoil * 0.15)
      : clamp01(coil * 0.45 + kick * 0.4 + volCoil * 0.15);
  }
  let mx = 0;
  for (let i = 0; i < n; i++) if (out[i] > mx) mx = out[i];
  if (mx > 1e-6) {
    for (let i = 0; i < n; i++) out[i] /= mx;
  }
  return out;
}

/** Empathic intent: volume and return sign agreement (−1..+1). */
export function empathicIntent(vp, bars) {
  if (!bars?.length) return 0;
  const { from, to } = visibleRange(vp);
  const i1 = Math.min(bars.length - 1, Math.ceil(to));
  const i0 = Math.max(1, Math.floor(from));
  let agree = 0, n = 0;
  for (let i = Math.max(i0, i1 - 20); i <= i1; i++) {
    const prev = bars[i - 1];
    const b = bars[i];
    if (!(prev?.c > 0) || !(b?.c > 0)) continue;
    const ret = Math.log(b.c / prev.c);
    const volUp = (b.v || 0) >= (prev.v || 0);
    if (Math.abs(ret) < 1e-6) continue;
    n++;
    if ((ret > 0 && volUp) || (ret < 0 && !volUp)) agree++;
    else agree--;
  }
  if (!n) return 0;
  return clamp(agree / n, -1, 1);
}

/** Pressure field: short momentum vs longer — divergence "pull". */
export function pressureField(vp, bars) {
  if (!bars || bars.length < 16) return 0;
  const { to } = visibleRange(vp);
  const i1 = Math.min(bars.length - 1, Math.ceil(to));
  const c = bars[i1]?.c;
  const cS = bars[Math.max(0, i1 - 5)]?.c;
  const cL = bars[Math.max(0, i1 - 16)]?.c;
  if (!(c > 0) || !(cS > 0) || !(cL > 0)) return 0;
  const short = Math.log(c / cS);
  const longer = Math.log(c / cL);
  const div = short - longer * (5 / 16);
  return clamp(div / 0.03, -1, 1);
}

/** Astral projection: ghost path + cone past last bar (volume-weighted drift + vol envelope). */
export function buildAstralProjection(bars, steps = 8) {
  if (!bars || bars.length < 6) return null;
  const n = bars.length;
  const last = bars[n - 1];
  if (!last || !(last.c > 0)) return null;
  let sum = 0, wSum = 0, rv = 0, cnt = 0;
  for (let i = n - 8; i < n; i++) {
    if (i < 1) continue;
    const a = bars[i - 1]?.c, b = bars[i]?.c;
    if (!(a > 0) || !(b > 0)) continue;
    const r = Math.log(b / a);
    const w = Math.max(0.25, Number.isFinite(bars[i]?.v) ? Math.sqrt(bars[i].v + 1) : 1);
    sum += r * w;
    wSum += w;
    rv += r * r;
    cnt++;
  }
  if (!cnt || !(wSum > 0)) return null;
  const mu = sum / wSum;
  const sigma = Math.sqrt(Math.max(1e-12, rv / cnt - (sum / wSum) * (sum / wSum) * 0.5));
  const path = [];
  let p = last.c;
  for (let s = 1; s <= steps; s++) {
    p *= Math.exp(mu);
    const band = p * (Math.exp(sigma * Math.sqrt(s) * 1.65) - 1);
    path.push({
      i: n - 1 + s,
      mid: p,
      hi: p + band,
      lo: Math.max(1e-12, p - band),
    });
  }
  return { path, mu, sigma, fromI: n - 1, fromP: last.c };
}

/** Attach psionic metrics onto a clarity-scaled syn frame. */
export function applyPsionic(syn, psi, intensityName = "balanced") {
  if (!syn || !psi) return syn;
  const gain = intensityName === "gentle" ? 0.55
    : intensityName === "vivid" ? 1.15
    : 0.9;
  // Motion-minimal: damp pulse-y layers further
  const motion = syn.preset?.motion ?? 1;
  const g = gain * Math.max(0.35, 0.5 + 0.5 * motion);
  return {
    ...syn,
    psi: {
      ...psi,
      reception: clamp01(psi.reception),
      precog: clamp01(finiteOr(psi.precog, 0) * g),
      intent: clamp(finiteOr(psi.intent, 0) * g, -1, 1),
      field: clamp(finiteOr(psi.field, 0) * g, -1, 1),
      gain: g,
    },
  };
}

/** Overlay paint — precog nodes, astral cone, intent beam, field arcs, reception veil. */
export function paintPsionicOverlay(ctx, {
  vp, bars, plot, theme, syn, nowSec = 0,
}) {
  const psi = syn?.psi;
  if (!psi || !bars?.length || !plot?.w) return;
  const tok = theme.synesthesia || {};
  const psiCol = tok.psi || "#d4a5ff";
  const astral = tok.astral || "#7ee0ff";
  const precogCol = tok.precog || "#ffb3e6";
  const g = psi.gain ?? 1;
  const animate = syn.animate !== false && syn.motionTier !== "minimal";

  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.x, plot.y, plot.w, plot.h);
  ctx.clip();

  paintReceptionVeil(ctx, { plot, reception: psi.reception, color: psiCol, g });
  paintPrecogNodes(ctx, {
    vp, bars, plot, precursors: psi.precursors, color: precogCol, g, nowSec, animate,
  });
  paintFieldArcs(ctx, {
    vp, bars, plot, field: psi.field, color: psiCol, g,
  });
  paintIntentBeam(ctx, {
    vp, bars, plot, intent: psi.intent, color: astral, g,
  });
  paintAstralCone(ctx, {
    vp, plot, projection: psi.projection, color: astral, g, nowSec, animate,
  });

  ctx.restore();

  paintPsiMeters(ctx, {
    plot, psi, tok,
    font: theme.legend?.font || "500 12px 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
  });
}

function paintReceptionVeil(ctx, { plot, reception, color, g }) {
  const recv = clamp01(reception);
  if (recv >= 0.72) {
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.04 * g * recv;
    ctx.lineWidth = 1;
    const step = 28;
    ctx.beginPath();
    for (let x = plot.x; x < plot.x + plot.w; x += step) {
      ctx.moveTo(x + 0.5, plot.y);
      ctx.lineTo(x + 0.5, plot.y + plot.h);
    }
    for (let y = plot.y; y < plot.y + plot.h; y += step) {
      ctx.moveTo(plot.x, y + 0.5);
      ctx.lineTo(plot.x + plot.w, y + 0.5);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    return;
  }
  const density = Math.floor((1 - recv) * 40 * g);
  const w = Math.max(1, plot.w | 0);
  const h = Math.max(1, plot.h | 0);
  ctx.fillStyle = color;
  for (let i = 0; i < density; i++) {
    const x = plot.x + ((i * 97) % w);
    const y = plot.y + ((i * 53) % h);
    ctx.globalAlpha = 0.05 + (1 - recv) * 0.08;
    ctx.fillRect(x, y, 1.2, 1.2);
  }
  ctx.globalAlpha = 1;
}

function paintPrecogNodes(ctx, { vp, bars, plot, precursors, color, g, nowSec, animate }) {
  if (!precursors?.length) return;
  const { from, to } = visibleRange(vp);
  const i0 = Math.max(0, Math.floor(from));
  const i1 = Math.min(bars.length - 1, Math.ceil(to));
  const pulse = animate ? (0.5 + 0.5 * Math.sin(nowSec * 3.1)) : 0.7;
  for (let i = i0; i <= i1; i++) {
    const s = precursors[i];
    if (!(s >= 0.45) || !bars[i]) continue;
    const x = plot.x + indexToX(vp, i);
    const y = plot.y + priceToY(vp, bars[i].c);
    const r = 2.5 + s * 5 * g * (0.7 + 0.3 * pulse);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.globalAlpha = (0.15 + 0.45 * s) * g;
    ctx.lineWidth = 1.25;
    ctx.stroke();
    const d = r * 0.45;
    ctx.beginPath();
    ctx.moveTo(x, y - d);
    ctx.lineTo(x + d, y);
    ctx.lineTo(x, y + d);
    ctx.lineTo(x - d, y);
    ctx.closePath();
    ctx.globalAlpha = (0.2 + 0.4 * s) * g;
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function paintFieldArcs(ctx, { vp, bars, plot, field, color, g }) {
  if (Math.abs(field) < 0.12 || !bars.length) return;
  const last = bars.length - 1;
  if (!bars[last]) return;
  const x = plot.x + indexToX(vp, last);
  const y = plot.y + priceToY(vp, bars[last].c);
  const dir = field > 0 ? -1 : 1;
  const strength = Math.abs(field);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.1;
  for (let k = 1; k <= 3; k++) {
    const r = 12 + k * 10 * strength * g;
    ctx.globalAlpha = (0.22 - k * 0.05) * strength * g;
    ctx.beginPath();
    ctx.arc(x, y, r, Math.PI * (0.15 + (dir < 0 ? 0 : 0.5)), Math.PI * (0.85 + (dir < 0 ? 0 : 0.5)));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function paintIntentBeam(ctx, { vp, bars, plot, intent, color, g }) {
  if (Math.abs(intent) < 0.15 || bars.length < 4) return;
  const last = bars.length - 1;
  const mid = Math.max(0, last - 12);
  if (!bars[mid] || !bars[last]) return;
  const x0 = plot.x + indexToX(vp, mid);
  const y0 = plot.y + priceToY(vp, bars[mid].c);
  const x1 = plot.x + indexToX(vp, last);
  const y1 = plot.y + priceToY(vp, bars[last].c);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.2 + 0.35 * Math.abs(intent) * g;
  ctx.lineWidth = 1 + Math.abs(intent) * 1.5;
  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  const cy = (y0 + y1) / 2 + intent * -18 * g;
  ctx.quadraticCurveTo((x0 + x1) / 2, cy, x1, y1);
  ctx.stroke();
  ctx.setLineDash([]);
  const ang = Math.atan2(y1 - cy, x1 - (x0 + x1) / 2);
  const ah = 6;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - ah * Math.cos(ang - 0.4), y1 - ah * Math.sin(ang - 0.4));
  ctx.lineTo(x1 - ah * Math.cos(ang + 0.4), y1 - ah * Math.sin(ang + 0.4));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = 1;
}

function paintAstralCone(ctx, { vp, plot, projection, color, g, nowSec, animate }) {
  if (!projection?.path?.length) return;
  const { path, fromI, fromP } = projection;
  if (!(fromP > 0)) return;
  const shimmer = animate ? (0.85 + 0.15 * Math.sin(nowSec * 2.2)) : 0.9;
  const pts = [{ i: fromI, mid: fromP, hi: fromP, lo: fromP }, ...path];

  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const x = plot.x + indexToX(vp, pts[i].i);
    const y = plot.y + priceToY(vp, pts[i].hi);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const x = plot.x + indexToX(vp, pts[i].i);
    const y = plot.y + priceToY(vp, pts[i].lo);
    ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.06 * g * shimmer;
  ctx.fill();

  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const x = plot.x + indexToX(vp, pts[i].i);
    const y = plot.y + priceToY(vp, pts[i].mid);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.35 * g * shimmer;
  ctx.lineWidth = 1.25;
  ctx.setLineDash([3, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

function paintPsiMeters(ctx, { plot, psi, tok, font }) {
  const rows = [
    { label: "recv", v: psi.reception, color: tok.psi || "#d4a5ff" },
    { label: "precog", v: psi.precog, color: tok.precog || "#ffb3e6" },
    { label: "intent", v: (psi.intent + 1) / 2, color: tok.astral || "#7ee0ff", signed: true },
    { label: "field", v: (psi.field + 1) / 2, color: tok.regimeHue || "#c4a1ff", signed: true },
  ];
  const x0 = plot.x + 118;
  const y0 = plot.y + plot.h - 8 - rows.length * 13;
  const barW = 44;
  ctx.save();
  ctx.font = font;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  ctx.globalAlpha = 0.9;
  ctx.fillStyle = "rgba(13,16,23,0.72)";
  const chip = "psionic";
  const chipW = ctx.measureText(chip).width + 10;
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x0 - 2, y0 - 14, chipW, 12, 3);
    ctx.fill();
  } else {
    ctx.fillRect(x0 - 2, y0 - 14, chipW, 12);
  }
  ctx.fillStyle = tok.psi || "#d4a5ff";
  ctx.fillText(chip, x0 + 3, y0 - 8);

  rows.forEach((r, i) => {
    const y = y0 + i * 13 + 6;
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "rgba(13,16,23,0.55)";
    ctx.fillRect(x0 - 2, y - 6, 36 + barW + 8, 11);
    ctx.globalAlpha = 1;
    ctx.fillStyle = r.color;
    ctx.fillText(r.label, x0, y);
    ctx.fillStyle = "rgba(139,147,167,0.25)";
    ctx.fillRect(x0 + 36, y - 3, barW, 5);
    const fw = Math.max(1, barW * clamp01(r.v));
    ctx.fillStyle = r.color;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x0 + 36, y - 3, fw, 5);
    if (r.signed) {
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = "#0d1017";
      ctx.fillRect(x0 + 36 + barW / 2 - 0.5, y - 3, 1, 5);
    }
    ctx.globalAlpha = 1;
  });
  ctx.restore();
}

function clamp01(x) { return Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0)); }
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function finiteOr(x, d) { return Number.isFinite(x) ? x : d; }
