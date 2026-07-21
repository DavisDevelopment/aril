// glcharts/theme.js — theme tokens for the WebGL charting library (WEBGL_VIZ_PLAN.md §3).
// Every visual is a token; consumers pass partial overrides and we deep-merge onto a base.
// Colors are plain CSS hex/rgba strings; the GL layer parses them once per theme apply.

export const DARK = {
  name: "dark",
  bg: "transparent",            // the GL canvas clears transparent; container owns the bg
  up: "#2dbd85",
  down: "#f6465d",
  wickUp: "#2dbd85",
  wickDown: "#f6465d",
  bodyFrac: 0.72,               // candle body width as a fraction of one bar slot
  wickPx: 1,                    // wick width (CSS px)
  minBodyPx: 1,                 // doji bodies never collapse below this
  volumeAlpha: 0.32,
  volumeHeightFrac: 0.18,       // bottom band of the chart area reserved for volume
  line: {
    color: "#4f8ff7",
    width: 1.6,
    heartbeat: {
      enabled: true,
      ampPx: 2.4,     // max normal displacement at full vol
      splitPx: 1.7,   // max filament half-gap at the crown
      period: 2.6,    // seconds between crests at a fixed bar
    },
  },
  area: { color: "#4f8ff7", alphaTop: 0.28, alphaBottom: 0.02 },
  grid: { color: "rgba(139,147,167,0.10)", strong: "rgba(139,147,167,0.20)" },
  axis: {
    text: "#8b93a7",
    font: "500 11px 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
    line: "rgba(139,147,167,0.25)",
    rightWidth: 62,             // CSS px gutter for the price axis
    bottomHeight: 22,           // CSS px gutter for the time axis
  },
  crosshair: {
    color: "rgba(139,147,167,0.85)",
    dash: [4, 4],
    labelBg: "#2a3242",
    labelText: "#e8ecf4",
  },
  legend: {
    text: "#e8ecf4",
    muted: "#8b93a7",
    font: "500 12px 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
  },
  lastPrice: { line: true, dash: [2, 3] },  // pill colored by up/down automatically
  // Synesthesia pack — gated by GlChart.synesthesia (toggle). Cool↔warm by vol, etc.
  synesthesia: {
    cool: "#5b8def",
    warm: "#ff7a59",
    regimeHue: "#c4a1ff",
    gravity: "#6b4cff",
    mist: "rgba(255, 122, 89, 0.07)",
    aurora: "#5ec8ff",
    vwap: "#9ef0d0",
    leash: "#7ad4b0",
    psi: "#d4a5ff",
    astral: "#7ee0ff",
    precog: "#ffb3e6",
    massWidthBoost: 1.35,
    hazeDisplacePx: 1.1,
  },
  drawing: {
    color: "#f0c14b",
    width: 1.4,
    handleRadius: 5,
    handleFill: "#0d1017",
    handleStroke: "#f0c14b",
  },
  inspect: {
    band: "rgba(79,143,247,0.10)",
    outline: "rgba(79,143,247,0.85)",
    cardBg: "rgba(22,28,40,0.94)",
    cardBorder: "rgba(139,147,167,0.35)",
    cardShadow: "rgba(0,0,0,0.35)",
    titleFont: "600 13px 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
    bodyFont: "500 12px 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
  },
};

export const LIGHT = {
  ...DARK,
  name: "light",
  up: "#1a9e6f",
  down: "#e0344c",
  wickUp: "#1a9e6f",
  wickDown: "#e0344c",
  line: {
    color: "#2266d8",
    width: 1.6,
    heartbeat: {
      enabled: true,
      ampPx: 2.4,
      splitPx: 1.7,
      period: 2.6,
    },
  },
  area: { color: "#2266d8", alphaTop: 0.22, alphaBottom: 0.02 },
  grid: { color: "rgba(60,70,90,0.10)", strong: "rgba(60,70,90,0.20)" },
  axis: { ...DARK.axis, text: "#5a6274", line: "rgba(60,70,90,0.25)" },
  crosshair: { ...DARK.crosshair, color: "rgba(60,70,90,0.85)", labelBg: "#e8ecf4", labelText: "#1b2230" },
  legend: { ...DARK.legend, text: "#1b2230", muted: "#5a6274" },
  synesthesia: {
    cool: "#3a6fd8",
    warm: "#e85d3a",
    regimeHue: "#8b5cf6",
    gravity: "#5b3fd4",
    mist: "rgba(232, 93, 58, 0.06)",
    aurora: "#3aa8e8",
    vwap: "#2a9d7a",
    leash: "#3cb890",
    psi: "#a78bfa",
    astral: "#38bdf8",
    precog: "#e879b8",
    massWidthBoost: 1.35,
    hazeDisplacePx: 1.1,
  },
  drawing: {
    color: "#c48a00",
    width: 1.4,
    handleRadius: 5,
    handleFill: "#ffffff",
    handleStroke: "#c48a00",
  },
  inspect: {
    band: "rgba(34,102,216,0.10)",
    outline: "rgba(34,102,216,0.85)",
    cardBg: "rgba(255,255,255,0.96)",
    cardBorder: "rgba(60,70,90,0.25)",
    cardShadow: "rgba(0,0,0,0.12)",
    titleFont: "600 13px 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
    bodyFont: "500 12px 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
  },
};

const THEMES = { dark: DARK, light: LIGHT };

/** Resolve a theme: name string, partial override object, or undefined → full token set. */
export function resolveTheme(theme) {
  if (!theme) return DARK;
  if (typeof theme === "string") return THEMES[theme] || DARK;
  const base = THEMES[theme.name] || DARK;
  return deepMerge(base, theme);
}

function deepMerge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && typeof base[k] === "object"
      ? deepMerge(base[k], v)
      : v;
  }
  return out;
}

/** Parse a CSS color ("#rgb", "#rrggbb", "rgba(r,g,b,a)") → [r,g,b,a] floats 0..1 for GL. */
export function parseColor(css, alpha = 1) {
  if (typeof css !== "string") return [1, 1, 1, alpha];
  const s = css.trim();
  if (s[0] === "#") {
    const hex = s.slice(1);
    const n = hex.length === 3
      ? hex.split("").map((c) => parseInt(c + c, 16))
      : [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    if (n.some((x) => !Number.isFinite(x))) return [1, 1, 1, alpha];
    return [n[0] / 255, n[1] / 255, n[2] / 255, alpha];
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const p = m[1].split(",").map((x) => parseFloat(x));
    return [p[0] / 255, p[1] / 255, p[2] / 255, (p.length > 3 ? p[3] : 1) * alpha];
  }
  return [1, 1, 1, alpha];
}
