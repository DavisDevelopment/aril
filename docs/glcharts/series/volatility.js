// glcharts/series/volatility.js — PURE rolling-vol estimate → 0..1 heartbeat intensity.

import { visibleRange } from "../core/viewport.js";

/**
 * Std-dev of log-returns over the visible window (fallback: last N bars), mapped to 0..1.
 * Quiet markets sit near ~0.15 (a whisper of pulse); wild markets approach 1.
 */
export function heartbeatIntensity(vp, bars, { lookback = 80 } = {}) {
  if (!bars || bars.length < 3) return 0.15;
  const { from, to } = visibleRange(vp);
  let i0 = Math.max(1, Math.floor(from));
  let i1 = Math.min(bars.length - 1, Math.ceil(to));
  if (i1 - i0 < 8) {
    i1 = bars.length - 1;
    i0 = Math.max(1, i1 - lookback);
  }
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let i = i0; i <= i1; i++) {
    const a = bars[i - 1]?.c;
    const b = bars[i]?.c;
    if (!(a > 0) || !(b > 0)) continue;
    const r = Math.log(b / a);
    if (!Number.isFinite(r)) continue;
    sum += r;
    sum2 += r * r;
    n++;
  }
  if (n < 4) return 0.15;
  const mean = sum / n;
  const variance = Math.max(0, sum2 / n - mean * mean);
  const sigma = Math.sqrt(variance);
  // Empirically: daily crypto σ~0.02–0.06, calm equities ~0.005–0.015 on 1h samples.
  // Soft knee so quiet series still breathe a little.
  const t = (sigma - 0.002) / 0.045;
  return clamp(0.12 + 0.88 * smoothstep(t), 0.12, 1);
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function smoothstep(x) {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}
