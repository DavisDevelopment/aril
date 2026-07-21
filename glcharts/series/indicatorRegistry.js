// glcharts/series/indicatorRegistry.js — data-driven indicator registry.
//
// Phase-0 of the FCS-superset build: indicators stop being a hardcoded switch and become
// registered entries { def, compute }. Built-ins register in indicators.js; MuseScript-backed
// indicators register the same way once compiled (see the volume-profile kernel precedent),
// so growing toward 50+ never touches this file.
//
// An indicator entry:
//   {
//     def: { id, name, category, target:"overlay"|"pane", params:[...], color, paneHeight? },
//     compute(bars, params, ctx) -> series object, e.g. { mid:[...] } or { mid, upper, lower }
//                                   or { mid, signal, hist } or { mid, range:[lo,hi], guides:[...] }
//     source?: "<MuseScript .ms text>",   // kept so the in-app IDE can VIEW + FORK the indicator
//     labels?: { mid:"x", ... },          // plot-label → series-slot map (for the fork editor)
//     lang?: "musescript" | "js",
//     forkable?: boolean,
//   }
// `ctx` carries shared precomputed inputs (currently { closes }) so compute fns don't each
// re-derive them. Keeping `source` on the entry is what makes every indicator viewable/forkable in
// the Strategy Studio / MuseLab IDE — see getIndicatorSource / getIndicatorMeta below.

const REGISTRY = new Map();

/** Register (or replace) an indicator. Returns the def for chaining/introspection. */
export function registerIndicator(entry) {
  if (!entry?.def?.id || typeof entry.compute !== "function") {
    throw new Error("registerIndicator requires { def:{id}, compute() }");
  }
  const def = Object.freeze({ ...entry.def, params: Object.freeze([...(entry.def.params || [])]) });
  const source = typeof entry.source === "string" ? entry.source : null;
  REGISTRY.set(def.id, {
    def,
    compute: entry.compute,
    source,
    labels: entry.labels ? { ...entry.labels } : null,
    lang: entry.lang || (source ? "musescript" : "js"),
    forkable: entry.forkable ?? !!source,
  });
  return def;
}

/** The MuseScript source for an indicator (null for JS-only entries). Used by the IDE viewer. */
export function getIndicatorSource(id) {
  return REGISTRY.get(id)?.source || null;
}

/** Fork/IDE metadata for an indicator: { id, name, lang, forkable, source, labels }. */
export function getIndicatorMeta(id) {
  const e = REGISTRY.get(id);
  if (!e) return null;
  return {
    id: e.def.id,
    name: e.def.name,
    lang: e.lang,
    forkable: e.forkable,
    source: e.source,
    labels: e.labels ? { ...e.labels } : null,
  };
}

export function unregisterIndicator(id) {
  return REGISTRY.delete(id);
}

export function getIndicatorEntry(id) {
  return REGISTRY.get(id) || null;
}

export function getIndicatorDef(id) {
  return REGISTRY.get(id)?.def || null;
}

/** Registration-ordered defs (optionally filtered by category). */
export function listIndicatorDefs(category) {
  const defs = [...REGISTRY.values()].map((e) => e.def);
  return category ? defs.filter((d) => d.category === category) : defs;
}

export function getRegisteredIndicatorIds() {
  return [...REGISTRY.keys()];
}

/** Merge defaults + user params; clamp numeric ranges. */
export function resolveIndicatorParams(id, params = {}) {
  const def = getIndicatorDef(id);
  if (!def) return {};
  const out = {};
  for (const p of def.params) {
    let v = params[p.key];
    if (v == null || !Number.isFinite(+v)) v = p.default;
    v = +v;
    if (p.min != null) v = Math.max(p.min, v);
    if (p.max != null) v = Math.min(p.max, v);
    out[p.key] = v;
  }
  return out;
}

let _indSeq = 0;
export function createIndicatorInstance(id, params = {}, opts = {}) {
  const def = getIndicatorDef(id);
  if (!def) return null;
  const p = resolveIndicatorParams(id, params);
  return {
    uid: opts.uid || `ind_${Date.now().toString(36)}_${(++_indSeq).toString(36)}`,
    id: def.id,
    params: p,
    visible: opts.visible !== false,
    color: opts.color || def.color,
  };
}

/** Compute series values for one active indicator instance against bars. */
export function computeIndicator(bars, instance) {
  if (!instance || !bars?.length) return null;
  const entry = REGISTRY.get(instance.id);
  if (!entry) return null;
  const p = resolveIndicatorParams(instance.id, instance.params);
  const ctx = { closes: bars.map((b) => b.c) };
  const series = entry.compute(bars, p, ctx);
  if (!series) return null;
  return {
    ...instance,
    def: entry.def,
    series,
    target: entry.def.target,
    paneHeight: entry.def.paneHeight || 72,
  };
}

export function computeAllIndicators(bars, instances = []) {
  if (!Array.isArray(instances) || !instances.length) return [];
  return instances.map((inst) => computeIndicator(bars, inst)).filter(Boolean);
}

/** Total CSS px reserved under the main price plot for pane indicators. */
export function paneStackHeight(computed = [], { maxFrac = 0.42, plotH = 400 } = {}) {
  let h = 0;
  for (const c of computed) {
    if (!c.visible || c.target !== "pane") continue;
    h += c.paneHeight || 72;
  }
  const cap = Math.max(0, plotH * maxFrac);
  return Math.min(h, cap);
}
