// glcharts/series/indicators.js — built-in indicator math + registration of the reference set.
// Standalone (no Classic imports). Overlay/pane targets mirror Classic registry ids.
//
// The generic engine (register/compute/list/instances) lives in ./indicatorRegistry.js. This file
// owns the PURE math and registers the seven reference indicators into that registry. Adding an
// indicator — JS or MuseScript-compiled — is a `registerIndicator({ def, compute })` call and never
// edits a switch. `INDICATOR_DEFS` is kept as a post-registration snapshot for back-compat.

import {
  registerIndicator,
  getIndicatorDef,
  getIndicatorSource,
  getIndicatorMeta,
  listIndicatorDefs,
  getRegisteredIndicatorIds,
  resolveIndicatorParams,
  createIndicatorInstance,
  computeIndicator,
  computeAllIndicators,
  paneStackHeight,
} from "./indicatorRegistry.js";

const EPS = 1e-9;

// ── reference indicator set (registration order = catalog/UI order) ──────────────────────────

registerIndicator({
  def: {
    id: "MA", name: "SMA", category: "MA", target: "overlay",
    params: [{ key: "n", label: "Period", type: "number", default: 20, min: 1, max: 500 }],
    color: "#4f8ff7",
  },
  compute: (_bars, p, { closes }) => ({ mid: sma(closes, p.n) }),
});

registerIndicator({
  def: {
    id: "EMA", name: "EMA", category: "MA", target: "overlay",
    params: [{ key: "n", label: "Period", type: "number", default: 12, min: 1, max: 500 }],
    color: "#f0c14b",
  },
  compute: (_bars, p, { closes }) => ({ mid: ema(closes, p.n) }),
});

registerIndicator({
  def: {
    id: "BOLL", name: "Bollinger", category: "Volatility", target: "overlay",
    params: [
      { key: "n", label: "Period", type: "number", default: 20, min: 1, max: 500 },
      { key: "k", label: "StdDev", type: "number", default: 2, min: 0.1, max: 10 },
    ],
    color: "#7ad4b0",
  },
  compute: (_bars, p, { closes }) => {
    const b = bollinger(closes, p.n, p.k);
    return { mid: b.mid, upper: b.upper, lower: b.lower };
  },
});

registerIndicator({
  def: { id: "VWAP", name: "VWAP", category: "Volume", target: "overlay", params: [], color: "#9ef0d0" },
  compute: (bars) => ({ mid: vwapSeries(bars) }),
});

registerIndicator({
  def: {
    id: "RSI", name: "RSI", category: "Momentum", target: "pane",
    params: [{ key: "n", label: "Period", type: "number", default: 14, min: 2, max: 200 }],
    color: "#c4a1ff", paneHeight: 72,
  },
  compute: (_bars, p, { closes }) => ({ mid: rsi(closes, p.n), range: [0, 100], guides: [30, 70] }),
});

registerIndicator({
  def: {
    id: "MACD", name: "MACD", category: "Momentum", target: "pane",
    params: [
      { key: "fast", label: "Fast", type: "number", default: 12, min: 1, max: 50 },
      { key: "slow", label: "Slow", type: "number", default: 26, min: 2, max: 100 },
      { key: "sig", label: "Signal", type: "number", default: 9, min: 1, max: 50 },
    ],
    color: "#ff7a59", paneHeight: 80,
  },
  compute: (_bars, p, { closes }) => {
    const m = macd(closes, p.fast, p.slow, p.sig);
    return { mid: m.macd, signal: m.signal, hist: m.histogram };
  },
});

registerIndicator({
  def: {
    id: "ATR", name: "ATR", category: "Volatility", target: "pane",
    params: [{ key: "n", label: "Period", type: "number", default: 14, min: 1, max: 200 }],
    color: "#5b8def", paneHeight: 64,
  },
  compute: (bars, p) => ({ mid: atr(bars, p.n) }),
});

/** Post-registration snapshot of the reference set (back-compat with earlier default export). */
export const INDICATOR_DEFS = Object.freeze(listIndicatorDefs());

// Re-export the registry API so existing `import { ... } from "./indicators.js"` keeps working.
export {
  registerIndicator,
  getIndicatorDef,
  getIndicatorSource,
  getIndicatorMeta,
  listIndicatorDefs,
  getRegisteredIndicatorIds,
  resolveIndicatorParams,
  createIndicatorInstance,
  computeIndicator,
  computeAllIndicators,
  paneStackHeight,
};

// ── math ───────────────────────────────────────────────────────────────────────────────────

export function sma(closes, n = 20) {
  const out = new Array(closes.length).fill(null);
  if (!closes?.length || n < 1) return out;
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    const v = closes[i];
    if (!Number.isFinite(v)) { out[i] = null; continue; }
    sum += v;
    if (i >= n) {
      const old = closes[i - n];
      if (Number.isFinite(old)) sum -= old;
    }
    if (i >= n - 1) {
      // recompute window if any nulls slipped in
      let s = 0, c = 0;
      for (let k = i - n + 1; k <= i; k++) {
        if (Number.isFinite(closes[k])) { s += closes[k]; c++; }
      }
      out[i] = c === n ? s / n : null;
    }
  }
  return out;
}

export function ema(closes, n = 12) {
  const out = new Array(closes.length).fill(null);
  if (!closes?.length || n < 1) return out;
  const a = 2 / (n + 1);
  let prev = null;
  for (let i = 0; i < closes.length; i++) {
    const v = closes[i];
    if (!Number.isFinite(v)) { out[i] = null; continue; }
    if (prev == null) {
      // seed with SMA of first n when possible
      if (i >= n - 1) {
        let s = 0, c = 0;
        for (let k = i - n + 1; k <= i; k++) {
          if (Number.isFinite(closes[k])) { s += closes[k]; c++; }
        }
        prev = c ? s / c : v;
        out[i] = prev;
      }
      continue;
    }
    prev = a * v + (1 - a) * prev;
    out[i] = prev;
  }
  return out;
}

export function bollinger(closes, n = 20, k = 2) {
  const mid = sma(closes, n);
  const upper = new Array(closes.length).fill(null);
  const lower = new Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i++) {
    if (mid[i] == null) continue;
    const lo = Math.max(0, i - n + 1);
    let s = 0, c = 0;
    for (let j = lo; j <= i; j++) {
      if (!Number.isFinite(closes[j])) continue;
      s += closes[j];
      c++;
    }
    if (c < 2) continue;
    const m = s / c;
    let varSum = 0;
    for (let j = lo; j <= i; j++) {
      if (!Number.isFinite(closes[j])) continue;
      const d = closes[j] - m;
      varSum += d * d;
    }
    const sd = Math.sqrt(varSum / c);
    upper[i] = mid[i] + k * sd;
    lower[i] = mid[i] - k * sd;
  }
  return { mid, upper, lower };
}

export function vwapSeries(bars) {
  const out = new Array(bars.length).fill(null);
  let pv = 0, vv = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (!b || !Number.isFinite(b.c)) continue;
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

export function rsi(closes, n = 14) {
  const out = new Array(closes.length).fill(null);
  if (!closes?.length || n < 1 || closes.length < n + 1) return out;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (!Number.isFinite(d)) continue;
    if (d >= 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= n;
  avgLoss /= n;
  const rs0 = avgGain / (avgLoss + EPS);
  out[n] = 100 - 100 / (1 + rs0);
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (!Number.isFinite(d)) { out[i] = out[i - 1]; continue; }
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (n - 1) + g) / n;
    avgLoss = (avgLoss * (n - 1) + l) / n;
    out[i] = 100 - 100 / (1 + avgGain / (avgLoss + EPS));
  }
  return out;
}

export function macd(closes, fast = 12, slow = 26, sigLen = 9) {
  const fastE = ema(closes, fast);
  const slowE = ema(closes, slow);
  const macdLine = closes.map((_, i) =>
    fastE[i] != null && slowE[i] != null ? fastE[i] - slowE[i] : null);
  // Signal as EMA over macd values (null-aware)
  const signal = new Array(closes.length).fill(null);
  const a = 2 / (sigLen + 1);
  let prev = null;
  let seen = 0;
  for (let i = 0; i < macdLine.length; i++) {
    const v = macdLine[i];
    if (v == null) continue;
    seen++;
    if (prev == null) {
      if (seen >= sigLen) {
        let s = 0, c = 0;
        for (let k = i; k >= 0 && c < sigLen; k--) {
          if (macdLine[k] != null) { s += macdLine[k]; c++; }
        }
        prev = c ? s / c : v;
        signal[i] = prev;
      }
      continue;
    }
    prev = a * v + (1 - a) * prev;
    signal[i] = prev;
  }
  const histogram = macdLine.map((m, i) =>
    m != null && signal[i] != null ? m - signal[i] : null);
  return { macd: macdLine, signal, histogram };
}

export function atr(bars, n = 14) {
  const out = new Array(bars.length).fill(null);
  if (!bars?.length || n < 1) return out;
  const tr = new Array(bars.length).fill(null);
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (!b || !Number.isFinite(b.h) || !Number.isFinite(b.l)) continue;
    const prevC = i > 0 && Number.isFinite(bars[i - 1]?.c) ? bars[i - 1].c : b.c;
    const range = b.h - b.l;
    const a = Math.abs(b.h - prevC);
    const c = Math.abs(b.l - prevC);
    tr[i] = Math.max(range, a, c);
  }
  let sum = 0, count = 0;
  for (let i = 0; i < bars.length; i++) {
    if (tr[i] == null) continue;
    if (count < n) {
      sum += tr[i];
      count++;
      if (count === n) out[i] = sum / n;
      continue;
    }
    // Wilder smooth
    const prev = out[i - 1];
    out[i] = prev != null ? (prev * (n - 1) + tr[i]) / n : tr[i];
  }
  return out;
}
