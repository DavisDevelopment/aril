// glcharts/sources/universeFilter.js — PURE symbol-universe filtering for the search modal.
// Implements FCS's search filters: searchModalTabs (category whitelist), searchAllowSymbols
// (symbol whitelist), searchExcludeSymbols (blacklist), plus a free-text query. Node-testable.
//
// A universe entry is { symbol, name?, category?|type?, exchange? }. Category examples:
// "forex" | "crypto" | "stock" | "index" | "commodity" | "future".

function upperSet(list) {
  return list && list.length ? new Set(list.map((s) => String(s).toUpperCase())) : null;
}

/**
 * Filter a symbol universe.
 * @param {Array} universe entries { symbol, name?, category?/type?, exchange? }
 * @param {object} opts
 *   tabs           category whitelist (searchModalTabs)
 *   allowSymbols   symbol whitelist (searchAllowSymbols)
 *   excludeSymbols symbol blacklist (searchExcludeSymbols)
 *   query          free-text match over symbol + name
 *   limit          max results (default 200)
 */
export function filterUniverse(universe, {
  tabs = null, allowSymbols = null, excludeSymbols = null, query = "", limit = 200,
} = {}) {
  if (!Array.isArray(universe)) return [];
  const allow = upperSet(allowSymbols);
  const exclude = upperSet(excludeSymbols);
  const tabSet = tabs && tabs.length ? new Set(tabs.map((t) => String(t).toLowerCase())) : null;
  const q = String(query || "").trim().toLowerCase();

  const out = [];
  for (const e of universe) {
    if (!e) continue;
    const sym = String(e.symbol || "").toUpperCase();
    if (!sym) continue;
    if (allow && !allow.has(sym)) continue;
    if (exclude && exclude.has(sym)) continue;
    if (tabSet) {
      const cat = String(e.category || e.type || "").toLowerCase();
      if (!tabSet.has(cat)) continue;
    }
    if (q) {
      const hay = `${sym} ${String(e.name || "").toLowerCase()}`;
      if (!hay.includes(q)) continue;
    }
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

/** Distinct categories present in a universe (for building search tabs). */
export function universeCategories(universe) {
  const seen = new Set();
  for (const e of universe || []) {
    const cat = String(e?.category || e?.type || "").toLowerCase();
    if (cat) seen.add(cat);
  }
  return [...seen];
}
