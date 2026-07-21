// glcharts/series/sensoryClarity.js — autistic-friendly sensory clarity layer.
// Goals: predictable rhythm, labeled meters (no mystery vibes), redundant shape+texture
// cues (not color-only), and an intensity dial so stimulation stays optional/controllable.

import { visibleRange, indexToX, priceToY } from "../core/viewport.js";

/** Intensity presets — multiply sensory gain without changing the mapping language. */
export const SENSORY_INTENSITY = {
  gentle:   { gain: 0.45, flash: 0.35, mist: 0.4, motion: 0.55, legend: true, steady: true },
  balanced: { gain: 0.85, flash: 0.7,  mist: 0.75, motion: 0.85, legend: true, steady: true },
  vivid:    { gain: 1.15, flash: 1.0,  mist: 1.0, motion: 1.0, legend: true, steady: false },
};

/** Motion-governor tier → clarity modifiers. `minimal` freezes motion/FX. */
export const MOTION_TIER_MOD = {
  rich:    { motion: 1, flash: 1, mist: 1, animate: true },
  reduced: { motion: 0.55, flash: 0.55, mist: 0.7, animate: true },
  minimal: { motion: 0, flash: 0.2, mist: 0.35, animate: false },
};

export function resolveIntensity(name = "balanced") {
  return SENSORY_INTENSITY[name] || SENSORY_INTENSITY.balanced;
}

export function resolveMotionTier(tier = "rich") {
  return MOTION_TIER_MOD[tier] || MOTION_TIER_MOD.rich;
}

/**
 * Scale a syn frame by intensity + optional motion-governor tier.
 * `minimal` locks steady metronome and zeroes continuous motion gain.
 */
export function applySensoryClarity(syn, intensityName = "balanced", prev = null, motionTier = "rich") {
  if (!syn) return null;
  const preset = { ...resolveIntensity(intensityName) };
  const tierMod = resolveMotionTier(motionTier);
  preset.motion *= tierMod.motion;
  preset.flash *= tierMod.flash;
  preset.mist *= tierMod.mist;
  // Minimal / gentle → always steady pulse period
  if (motionTier === "minimal" || preset.steady) preset.steady = true;

  const g = preset.gain;
  const out = {
    ...syn,
    intensity: intensityName,
    motionTier,
    preset,
    vol: clamp01(finiteOr(syn.vol, 0) * g),
    temp: clamp01(finiteOr(syn.temp, 0) * g),
    mass: clamp01(0.15 + (finiteOr(syn.mass, 0.4) - 0.15) * g),
    haze: clamp01(finiteOr(syn.haze, 0) * g),
    mist: clamp01(finiteOr(syn.mist, 0) * (preset.mist ?? g)),
    regimeFlash: clamp01(finiteOr(syn.regimeFlash, 0) * (preset.flash ?? g)),
    soft: clamp01(finiteOr(syn.soft, 0)),
    skew: clamp(finiteOr(syn.skew, 0) * g, -1, 1),
    ddDepth: clamp01(finiteOr(syn.ddDepth, 0) * g),
    peakFrac: clamp01(finiteOr(syn.peakFrac, 0)),
    // Steady metronome: pin period so lub-dub doesn't jitter with volume mass
    periodScale: preset.steady ? 1 : (finiteOr(syn.periodScale, 1) || 1),
    regimeSign: syn.regimeSign,
    bassHits: Array.isArray(syn.bassHits) ? syn.bassHits : [],
    sonicRing: syn.sonicRing || null,
    animate: tierMod.animate,
  };

  // Soft-land telegraph: keep a readable "regime arrow" while flash decays
  const sign = syn.regimeSign;
  let arrow = prev?.regimeArrow ?? null;
  if (finiteOr(syn.regimeFlash, 0) > 0.55 && sign != null) {
    arrow = { sign, born: (prev?.regimeArrow?.born ?? 0) || 1, strength: 1 };
  } else if (arrow) {
    // Freeze decay under minimal motion so the cue remains readable without pulsing
    const step = motionTier === "minimal" ? 0.004 : 0.018;
    arrow = { ...arrow, strength: Math.max(0, arrow.strength - step) };
    if (arrow.strength < 0.05) arrow = null;
  }
  out.regimeArrow = arrow;
  return out;
}

/**
 * Paint clarity HUD: labeled meters, texture on soft/provenance bars,
 * regime chevron (shape cue), calm grounding rails.
 */
export function paintClarityOverlay(ctx, {
  vp, bars, plot, theme, syn, intensity = "balanced",
}) {
  if (!syn || !bars?.length || !plot?.w) return;
  const preset = syn.preset || resolveIntensity(intensity);
  const tok = theme.synesthesia || {};
  const lg = theme.legend || {};

  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.x, plot.y, plot.w, plot.h);
  ctx.clip();

  // Grounding rails — calm, predictable frame (low-amp breathe only if vivid/rich)
  const railA = 0.14 + 0.06 * syn.vol * (preset.motion ?? 1);
  ctx.strokeStyle = tok.cool || "#5b8def";
  ctx.globalAlpha = Math.min(0.35, Math.max(0.08, railA));
  ctx.lineWidth = 1.25;
  ctx.strokeRect(plot.x + 0.5, plot.y + 0.5, plot.w - 1, plot.h - 1);
  ctx.globalAlpha = 1;

  // Soft/provenance texture — dots so "velvety" data is also shape-readable
  paintSoftTexture(ctx, { vp, bars, plot, soft: syn.soft, color: tok.cool || "#5b8def" });

  // Volume mass tick-marks under bars (redundant to line weight)
  paintMassTicks(ctx, { vp, bars, plot, mass: syn.mass, color: tok.warm || "#ff7a59" });

  // Drawdown depth hatch along peakFrac — redundant to gravity well
  paintDrawdownTicks(ctx, {
    vp, bars, plot, ddDepth: syn.ddDepth, peakFrac: syn.peakFrac,
    color: tok.gravity || "#6b4cff",
  });

  // Regime chevron — shape + direction, not flash alone
  if (syn.regimeArrow) {
    paintRegimeChevron(ctx, {
      plot,
      sign: syn.regimeArrow.sign,
      strength: syn.regimeArrow.strength,
      color: tok.regimeHue || "#c4a1ff",
    });
  }

  ctx.restore();

  if (preset.legend) {
    paintSensoryMeters(ctx, {
      plot, theme, syn, intensity, tok,
      font: lg.font || "500 12px 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
    });
  }
}

function paintSoftTexture(ctx, { vp, bars, plot, soft, color }) {
  if (!(soft > 0.08)) return;
  const { from, to } = visibleRange(vp);
  const i0 = Math.max(0, Math.floor(from));
  const i1 = Math.min(bars.length - 1, Math.ceil(to));
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.18 + 0.22 * soft;
  for (let i = i0; i <= i1; i++) {
    const b = bars[i];
    if (!b) continue;
    const isSoft = b.provenance === "mid_as_ohlc"
      || (b.o === b.h && b.h === b.l && b.l === b.c);
    if (!isSoft) continue;
    const x = plot.x + indexToX(vp, i);
    const y = plot.y + priceToY(vp, b.c);
    // Three-dot glyph — readable without color vision
    for (const dy of [-3, 0, 3]) {
      ctx.beginPath();
      ctx.arc(x, y + dy, 1.15, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function paintMassTicks(ctx, { vp, bars, plot, mass, color }) {
  if (!(mass > 0.35)) return;
  const { from, to } = visibleRange(vp);
  const i0 = Math.max(0, Math.floor(from));
  const i1 = Math.min(bars.length - 1, Math.ceil(to));
  let med = 1;
  const vols = [];
  for (let i = i0; i <= i1; i++) {
    if (Number.isFinite(bars[i]?.v)) vols.push(bars[i].v);
  }
  if (vols.length >= 4) {
    vols.sort((a, b) => a - b);
    med = vols[vols.length >> 1] || 1;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (let i = i0; i <= i1; i++) {
    const v = bars[i]?.v || 0;
    const ratio = v / Math.max(med, 1e-9);
    if (ratio < 1.15) continue;
    const h = Math.min(14, 3 + (ratio - 1) * 6) * (0.5 + 0.5 * mass);
    const x = Math.round(plot.x + indexToX(vp, i)) + 0.5;
    const y1 = plot.y + plot.h - 2;
    ctx.globalAlpha = Math.min(0.55, 0.15 + (ratio - 1) * 0.12);
    ctx.beginPath();
    ctx.moveTo(x, y1);
    ctx.lineTo(x, y1 - h);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function paintDrawdownTicks(ctx, { vp, bars, plot, ddDepth, peakFrac, color }) {
  if (!(ddDepth > 0.12) || !(peakFrac > 0.15)) return;
  const { from, to } = visibleRange(vp);
  const i0 = Math.max(0, Math.floor(from));
  const i1 = Math.min(bars.length - 1, Math.ceil(to));
  let peak = -Infinity;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  for (let i = Math.max(0, i0 - 40); i <= i1; i++) {
    const c = bars[i]?.c;
    if (!Number.isFinite(c)) continue;
    if (c > peak) peak = c;
    if (i < i0) continue;
    const dd = peak > 0 ? (peak - c) / peak : 0;
    if (dd < 0.01) continue;
    const x = Math.round(plot.x + indexToX(vp, i)) + 0.5;
    const y = plot.y + priceToY(vp, c);
    const h = Math.min(10, 2 + dd * 40) * ddDepth;
    ctx.globalAlpha = Math.min(0.4, 0.1 + dd * 0.5) * ddDepth;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + h);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

function paintRegimeChevron(ctx, { plot, sign, strength, color }) {
  const a = 0.25 + 0.55 * clamp01(strength);
  const cx = plot.x + plot.w - 28;
  const cy = plot.y + 28;
  const s = 10 + 4 * clamp01(strength);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.globalAlpha = a;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (sign >= 0) {
    ctx.moveTo(0, -s);
    ctx.lineTo(s * 0.85, s * 0.35);
    ctx.lineTo(0, s * 0.05);
    ctx.lineTo(-s * 0.85, s * 0.35);
  } else {
    ctx.moveTo(0, s);
    ctx.lineTo(s * 0.85, -s * 0.35);
    ctx.lineTo(0, -s * 0.05);
    ctx.lineTo(-s * 0.85, -s * 0.35);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Bottom-left labeled meters — always say what the senses mean. */
function paintSensoryMeters(ctx, { plot, syn, intensity, tok, font }) {
  const rows = [
    { key: "vol",  label: "vol",  v: syn.vol,  color: tok.warm || "#ff7a59" },
    { key: "temp", label: "temp", v: syn.temp, color: syn.temp > 0.55 ? (tok.warm || "#ff7a59") : (tok.cool || "#5b8def") },
    { key: "mass", label: "mass", v: syn.mass, color: tok.leash || "#7ad4b0" },
    { key: "dd",   label: "dd",   v: syn.ddDepth, color: tok.gravity || "#6b4cff" },
    { key: "skew", label: "skew", v: (syn.skew + 1) / 2, color: tok.regimeHue || "#c4a1ff", signed: true },
    { key: "soft", label: "soft", v: syn.soft, color: tok.cool || "#5b8def" },
  ];
  const x0 = plot.x + 8;
  const y0 = plot.y + plot.h - 8 - rows.length * 13;
  const barW = 52;
  ctx.save();
  ctx.font = font;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  // Intensity chip (+ motion tier when not rich)
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = "rgba(13,16,23,0.72)";
  const tier = syn.motionTier && syn.motionTier !== "rich" ? ` · ${syn.motionTier}` : "";
  const chip = `clarity · ${intensity}${tier}`;
  const chipW = ctx.measureText(chip).width + 10;
  fillRoundRect(ctx, x0 - 2, y0 - 14, chipW, 12, 3);
  ctx.fillStyle = tok.warm || "#ff7a59";
  ctx.fillText(chip, x0 + 3, y0 - 8);

  rows.forEach((r, i) => {
    const y = y0 + i * 13 + 6;
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "rgba(13,16,23,0.55)";
    ctx.fillRect(x0 - 2, y - 6, 28 + barW + 8, 11);
    ctx.globalAlpha = 1;
    ctx.fillStyle = r.color;
    ctx.fillText(r.label, x0, y);
    ctx.fillStyle = "rgba(139,147,167,0.25)";
    ctx.fillRect(x0 + 28, y - 3, barW, 5);
    const fw = Math.max(1, barW * clamp01(r.v));
    ctx.fillStyle = r.color;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x0 + 28, y - 3, fw, 5);
    if (r.signed) {
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = "#0d1017";
      ctx.fillRect(x0 + 28 + barW / 2 - 0.5, y - 3, 1, 5);
    }
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = "#0d1017";
    ctx.lineWidth = 1;
    for (let t = 1; t < 4; t++) {
      const tx = x0 + 28 + (barW * t) / 4;
      ctx.beginPath();
      ctx.moveTo(tx + 0.5, y - 3);
      ctx.lineTo(tx + 0.5, y + 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  });
  ctx.restore();
}

function fillRoundRect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
    return;
  }
  ctx.fillRect(x, y, w, h);
}

function finiteOr(x, d) { return Number.isFinite(x) ? x : d; }
function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
