// glcharts/series/chartTypes.js — data-driven chart-type registry.
//
// Phase-0 of the FCS-superset build: the chart-type set stops being an if/else on `this.type`
// inside GlChart and becomes registered descriptors. Each descriptor says which GL primitive
// draws it (`base`), whether the volume pane applies (`showsVolume`), and an optional pure
// bar-transform (`transform`) applied before the base series is built (e.g. Heikin-Ashi, Renko).
//
// A chart-type descriptor:
//   {
//     id,                       // "candles" | "heikinAshi" | "renko" | ...
//     label,                    // short toolbar label
//     base: "candles"|"ohlc"|"line"|"area",  // which existing GL drawer renders it
//     showsVolume: boolean,     // does the volume pane apply for this type?
//     transform?: (bars) => bars, // optional pure OHLCV re-derivation (identity when absent)
//     timeAligned?: boolean,    // false for Renko-style types whose x is not 1:1 with input bars
//     candleMode?: "normal"|"wicksOnly"|"hollow"|"volume",  // base:"candles" rendering variant
//   }
//
// Base descriptors register here; new FCS types (P1) register the same way and never edit GlChart.

import { BAR_TRANSFORMS } from "./barTransforms.js";

const REGISTRY = new Map();

/** Register (or replace) a chart type. Returns the descriptor. */
export function registerChartType(spec) {
  if (!spec?.id || !spec.base) throw new Error("registerChartType requires { id, base }");
  const desc = Object.freeze({
    id: spec.id,
    label: spec.label || spec.id,
    base: spec.base,
    showsVolume: spec.showsVolume !== false,
    transform: typeof spec.transform === "function" ? spec.transform : null,
    timeAligned: spec.timeAligned !== false,
    candleMode: spec.candleMode || "normal",
  });
  REGISTRY.set(desc.id, desc);
  return desc;
}

export function getChartType(id) {
  return REGISTRY.get(id) || null;
}

export function listChartTypes() {
  return [...REGISTRY.values()];
}

export function chartTypeIds() {
  return [...REGISTRY.keys()];
}

// ── base types (registration order = toolbar order; matches the pre-registry set) ────────────

registerChartType({ id: "candles", label: "candles", base: "candles", showsVolume: true });
registerChartType({ id: "ohlc", label: "ohlc", base: "ohlc", showsVolume: true });
registerChartType({ id: "line", label: "line", base: "line", showsVolume: false });
registerChartType({ id: "area", label: "area", base: "area", showsVolume: false });

// ── FCS-superset chart types (P1) ────────────────────────────────────────────────────────────
registerChartType({
  id: "heikinAshi", label: "HA", base: "candles", showsVolume: true,
  transform: BAR_TRANSFORMS.heikinAshi,
});
registerChartType({
  id: "hollow", label: "hollow", base: "candles", showsVolume: true, candleMode: "hollow",
});
registerChartType({
  id: "volumeCandles", label: "vol-candles", base: "candles", showsVolume: true, candleMode: "volume",
});
registerChartType({
  id: "highLow", label: "hi-lo", base: "candles", showsVolume: true, candleMode: "wicksOnly",
});
registerChartType({
  id: "renko", label: "renko", base: "candles", showsVolume: false, timeAligned: false,
  transform: BAR_TRANSFORMS.renko,
});
