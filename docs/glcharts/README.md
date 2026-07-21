# glcharts — WebGL2-powered 2D charting library (Advanced v2)

A self-contained, dependency-free charting engine (WEBGL_VIZ_PLAN.md §3). **Additive to**
`src/charting/` (klinecharts / ChartCore) — Classic Charts stays the default. Chart Workspace
exposes a **Classic | Advanced** toggle; Advanced mounts this engine.

All series geometry is rendered on the GPU via WebGL2 **instancing**; pan/zoom never re-uploads
buffers — only uniforms change, so 100k candles stay at 60fps. Crisp text (axes, crosshair,
legend, inspect card, drawings) lives on a Canvas2D overlay.

**No app imports.** Consumers speak the app-wide Bar contract `{ t,o,h,l,c,v }` (t = unix
seconds) — identical to `src/charting/`.

## Quick start

```js
import { GlChart } from "./glcharts/index.js";

const chart = new GlChart(containerEl, {
  theme: "dark",          // "dark" | "light" | { name, ...token patch }
  type: "candles",        // "candles" | "line" | "area"
  symbol: "BTC/USD",
  resolution: "1d",
  showVolume: true,
});
chart.setData(bars);       // Bar[] — normalized (sorted/deduped) internally
chart.append(bar);         // new bar (streaming)
chart.updateLast(bar);     // forming-bar tick
chart.fitContent();        // snap to newest
chart.dispose();
```

React: `import GlChartView from "./glcharts/react/GlChartView.jsx"` — mount-once wrapper, props
map 1:1 onto the calls above.

## Interactions (built in)

- **Navigate:** drag = pan (inertial flick) · wheel/pinch = cursor-anchored zoom · double-click/double-tap = fit
- **Inspect:** click a candle → selection band + detail card (OHLCV, change%, volume, bar #). Esc clears. Callback: `chart.onInspect = (info) => {}`
- **Draw:** `chart.setTool("segment"|"horizontalStraightLine"|"rayLine"|"rect"|"fibonacciLine")` — click to place points (rubber-band preview). Handles appear when selected; drag to edit; Delete removes; Esc cancels draft / exits tool. Persist via `getDrawings()` / `setDrawings()`.

## Layout of the package

| Path | What |
|---|---|
| `core/viewport.js` | PURE viewport/scale math |
| `core/renderer.js` | WebGL2 context, program cache, DPR sizing |
| `series/*` | instanced GPU series (candles, volume, line, area) |
| `drawings/*` | tool catalog, store, Canvas2D painter, geom helpers |
| `overlay/*` | axes, crosshair, legend, inspect card, selection |
| `interact/*` | gestures + hit-testing |
| `GlChart.js` | orchestrator (public class) |
| `react/GlChartView.jsx` | React binding (tool / drawings / onInspect props) |

## Dev harness & tests

- `node src/glcharts/glcharts.selftest.mjs` — pure-layer selftests (viewport, geometry, theme).
- `npm run dev` → open **`/glcharts-demo.html`** — synthetic random-walk feed with live-tick
  simulation, 1k/10k/100k stress buttons, candles/line/area, themes, and live bars via the
  dataserver `/market/bars` registry (equities/crypto/forex). Dev-only page; not in the app bundle.

## Design notes / v1 roadmap

- **Why not extend klinecharts?** It rasterizes on Canvas2D per frame; at 50k+ bars or on hi-DPI
  mobile the fill-rate dominates. glcharts uploads geometry once and lets the GPU project it.
  Classic Charts keeps indicators, multi-pane linking, and the full drawing suite we already ship.
- WebGL context loss → `GlChart.webgl === false`; the overlay still renders axes (graceful blank
  plot). A Canvas2D series fallback is a v1 item if we ever need it.
- v1: multi-pane indicator regions, log price scale, in-GL SDF text, live WS into Advanced panes —
  still as an additive Advanced path. Classic stays the default.
