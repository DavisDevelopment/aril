// glcharts/GlChart.js — the library's public chart class (WEBGL_VIZ_PLAN.md §3), the DEFAULT
// charting engine as of 2026-07-18 (Classic/klinecharts remains a full opt-out in ChartWorkspace).
// Owns: GL canvas + Canvas2D overlay, viewport, interaction, drawings, candle inspect.
// Bars contract: { t,o,h,l,c,v } with t = unix seconds (same as charting/ChartCore).
//
//   const chart = new GlChart(el, { theme: "dark", type: "candles", symbol: "BTC/USD" });
//   chart.setData(bars);
//   chart.setTool("segment");          // start drawing a trendline
//   chart.onInspect = (info) => {};    // candle click
//   chart.onDrawingsChange = (d) => {};

import { createRenderer } from "./core/renderer.js";
import {
  createViewport, setSize, fitRight, clampRight, autoFitPrice,
  panPx, zoomAt, visibleRange,
} from "./core/viewport.js";
import { normalizeBars } from "./series/geometry.js";
import { CandleSeries } from "./series/candles.js";
import { VolumeSeries } from "./series/volume.js";
import { LineSeries } from "./series/line.js";
import { AreaSeries } from "./series/area.js";
import { GravityWellSeries } from "./series/gravityWell.js";
import { AuroraSeries } from "./series/aurora.js";
import { VwapLeashSeries } from "./series/vwapLeash.js";
import { Overlay } from "./overlay/overlay.js";
import { attachInteraction } from "./interact/interaction.js";
import { hitTestBar, hitTestDrawing, plotToAnchor } from "./interact/hitTest.js";
import { resolveTheme } from "./theme.js";
import { TOOLS, pointsNeeded } from "./drawings/tools.js";
import { createDrawing, serializeDrawings, deserializeDrawings } from "./drawings/store.js";
import { computeSynesthesia } from "./series/synesthesia.js";
import { heartbeatIntensity } from "./series/volatility.js";
import { updateBassHits, updateSonicRing } from "./series/sensoryExtras.js";
import { applySensoryClarity } from "./series/sensoryClarity.js";
import { computePsionic, applyPsionic } from "./series/sensoryPsionic.js";
import {
  createIndicatorInstance, computeAllIndicators, paneStackHeight,
} from "./series/indicators.js";
import { getChartType } from "./series/chartTypes.js";
import { VpHeatSeries } from "./series/vpHeat.js";
import { GlowSeries } from "./series/glow.js";
import { MomentumSeries } from "./series/momentum.js";
import { ConfidenceFanSeries, FAN_BARS } from "./series/confidenceFan.js";

export class GlChart {
  constructor(container, {
    theme = "dark",
    type = "candles",
    symbol = "",
    resolution = "1d",
    showVolume = true,
    synesthesia = false,   // master sensory toggle — off by default
    sensoryIntensity = null, // gentle | balanced | vivid — null = auto (prefers-reduced-motion → gentle)
    motionTier = "rich",   // motion-governor: rich | reduced | minimal
    logScale = false,
    indicators = null,     // optional initial indicator instances
    vpHeat = false,        // volume-at-price heat backdrop (sequential)
    glow = false,          // additive bloom under the price
    momentumColor = false, // color the line by momentum (diverging)
    confidenceFan = false, // forward confidence cone
  } = {}) {
    this.container = container;
    this.theme = resolveTheme(theme);
    this.type = type;
    this.symbol = symbol;
    this.resolution = resolution;
    this.showVolume = showVolume;
    this.vpHeatOn = !!vpHeat;
    this.glowOn = !!glow;
    this.momentumOn = !!momentumColor;
    this.confidenceFanOn = !!confidenceFan;
    this.synesthesia = !!synesthesia;
    this.sensoryIntensity = sensoryIntensity
      || (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "gentle"
        : "balanced");
    // Accessibility floor: OS reduced-motion → motion-governor minimal
    const autoMinimal = typeof matchMedia === "function"
      && matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.motionTier = (motionTier === "reduced" || motionTier === "minimal")
      ? motionTier
      : (autoMinimal ? "minimal" : "rich");
    this._synState = null;
    this._synLastT = 0;
    this._sensoryDirty = true;
    this.indicators = Array.isArray(indicators) ? indicators.slice() : [];
    this._indicatorCache = [];
    this.bars = [];        // raw input bars (setData/append store; time-dedup source)
    this.viewBars = [];    // displayed series = chart-type transform of bars (identity for base types)
    this.replayIndex = null; // FCS replay: when set, only raw bars[0..replayIndex] are shown
    this.vp = createViewport();
    this.vp.logScale = !!logScale;
    this.cross = null;
    this._raf = 0;
    this._disposed = false;
    this.onSynesthesiaChange = null;
    this.onSensoryIntensityChange = null;
    this.onIndicatorsChange = null;

    // interaction state
    this.tool = null;                 // tool name or null (navigate)
    this.draftPoints = [];            // anchors placed so far for the active tool
    this.draftCursor = null;          // live rubber-band anchor
    this.drawings = [];
    this.priceLines = [];             // FCS horizontal-lines API entries
    this.magnet = false;              // magnet-snap: anchor value → nearest OHLC of the bar
    this.selectedDrawingId = null;
    this.selectedIndex = null;        // inspected candle index
    this._dragHandle = null;          // { drawingId, handleIndex } while editing
    this.onInspect = null;            // (info|null) => void
    this.onDrawingsChange = null;     // (Drawing[]) => void
    this.onToolChange = null;         // (toolName|null) => void
    this.onPeriodChange = null;       // (period) => void — app refetches bars for the new timeframe

    container.style.position ||= "relative";
    this.glCanvas = mkCanvas(container, 0);
    this.ovCanvas = mkCanvas(container, 1);

    this.renderer = createRenderer(this.glCanvas);
    this.webgl = !!this.renderer;
    if (this.renderer) {
      this.candles = new CandleSeries(this.renderer);
      this.volume = new VolumeSeries(this.renderer);
      this.line = new LineSeries(this.renderer);
      this.area = new AreaSeries(this.renderer);
      this.gravity = new GravityWellSeries(this.renderer);
      this.aurora = new AuroraSeries(this.renderer);
      this.vwapLeash = new VwapLeashSeries(this.renderer);
      this.vpHeat = new VpHeatSeries(this.renderer);
      this.glow = new GlowSeries(this.renderer);
      this.momentum = new MomentumSeries(this.renderer);
      this.confidenceFan = new ConfidenceFanSeries(this.renderer);
    }
    if (this.confidenceFanOn) this.vp.rightOffsetBars = FAN_BARS + 2;
    this.overlay = new Overlay(this.ovCanvas);

    this._detachInteraction = attachInteraction(this.ovCanvas, {
      getMode: () => (this.tool ? "draw" : "navigate"),
      pan: (dx) => {
        panPx(this.vp, dx);
        clampRight(this.vp, this.bars.length);
      },
      zoom: (factor, x) => {
        zoomAt(this.vp, factor, x - this._plot().x);
        clampRight(this.vp, this.bars.length);
      },
      cross: (x, y) => {
        if (x == null) { this.cross = null; return; }
        const p = this._plot();
        this.cross = {
          x: Math.min(p.w, Math.max(0, x - p.x)),
          y: Math.min(p.h, Math.max(0, y - p.y)),
        };
      },
      pointerDown: (x, y) => this._onPointerDown(x, y),
      pointerMove: (x, y) => this._onPointerMove(x, y),
      pointerUp: () => { this._dragHandle = null; },
      click: (x, y, mods) => this._onClick(x, y, mods),
      cancel: () => this._cancelTool(),
      key: (key, e) => this._onKey(key, e),
      fit: () => this.fitContent(),
      changed: () => this._invalidate(),
    });

    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(container);
    this._resize();

    // Axis/legend/inspect text loads a webfont (JetBrains Mono); canvas fillText silently
    // rasterizes with the fallback font if painted before it's ready, and never re-paints
    // on its own once the swap completes — force one repaint when fonts.ready resolves.
    if (typeof document !== "undefined" && document.fonts?.ready) {
      document.fonts.ready.then(() => { if (!this._disposed) this._invalidate(); });
    }
  }

  // ── data ─────────────────────────────────────────────────────────────────────────────

  setData(bars) {
    const stickRight = this._atRightEdge();
    this.bars = normalizeBars(bars);
    this._upload();
    if (this.selectedIndex != null && this.selectedIndex >= this.viewBars.length) {
      this.selectedIndex = null;
      this.onInspect?.(null);
    }
    if (stickRight || !this._everFit) {
      fitRight(this.vp, this.viewBars.length);
      this._everFit = true;
    }
    clampRight(this.vp, this.viewBars.length);
    this._invalidate();
  }

  append(bar) {
    const b = normalizeBars([bar])[0];
    if (!b) return;
    const last = this.bars[this.bars.length - 1];
    if (last && b.t <= last.t) return this.updateLast(b);
    const stickRight = this._atRightEdge();
    this.bars.push(b);
    this._upload();
    if (stickRight) fitRight(this.vp, this.viewBars.length);
    this._invalidate();
  }

  updateLast(bar) {
    const b = normalizeBars([bar])[0];
    if (!b) return;
    const i = this.bars.length - 1;
    if (i < 0 || b.t > this.bars[i].t) return this.append(b);
    if (b.t !== this.bars[i].t) return;
    this.bars[i] = b;
    this._upload();
    this._invalidate();
  }

  // ── config ───────────────────────────────────────────────────────────────────────────

  setType(type) {
    if (type === this.type) return;
    const prev = this.type;
    this.type = type;
    // Re-derive the displayed series when the transform identity changes (e.g. → Heikin-Ashi/Renko),
    // and re-fit since transformed OHLC (and Renko's bar count) shift the domain.
    const prevCt = getChartType(prev);
    const nextCt = getChartType(type);
    const transformChanged = (prevCt?.transform || null) !== (nextCt?.transform || null);
    if (transformChanged) {
      const stickRight = this._atRightEdge();
      this._upload();
      if (stickRight) fitRight(this.vp, this.viewBars.length);
      clampRight(this.vp, this.viewBars.length);
      if (this.selectedIndex != null && this.selectedIndex >= this.viewBars.length) {
        this.selectedIndex = null;
        this.onInspect?.(null);
      }
    }
    this._invalidate();
  }
  /** FCS-compatible alias for setType. */
  setChartType(type) { return this.setType(type); }
  setSymbol(symbol, resolution = this.resolution) {
    this.symbol = symbol; this.resolution = resolution; this._invalidate();
  }
  setTheme(theme) {
    this.theme = resolveTheme(typeof theme === "object" ? { name: this.theme.name, ...theme } : theme);
    this._invalidate();
  }
  setShowVolume(show) { this.showVolume = !!show; this._invalidate(); }

  // ── extra shader layers (vpHeat / glow / momentum / confidence fan) ──────────────────
  setVpHeat(on) { this.vpHeatOn = !!on; if (this.vpHeatOn) this.vpHeat?.setData(this.viewBars); this._invalidate(); }
  getVpHeat() { return this.vpHeatOn; }
  setGlow(on) { this.glowOn = !!on; if (this.glowOn) this.glow?.setData(this.viewBars); this._invalidate(); }
  getGlow() { return this.glowOn; }
  setMomentumColor(on) { this.momentumOn = !!on; if (this.momentumOn) this.momentum?.setData(this.viewBars); this._invalidate(); }
  getMomentumColor() { return this.momentumOn; }
  setConfidenceFan(on) {
    this.confidenceFanOn = !!on;
    this.vp.rightOffsetBars = on ? FAN_BARS + 2 : 2;
    if (on) this.confidenceFan?.setData(this.viewBars);
    fitRight(this.vp, this.viewBars.length);
    clampRight(this.vp, this.viewBars.length);
    this._invalidate();
  }
  getConfidenceFan() { return this.confidenceFanOn; }

  /** FCS setPeriod: change the timeframe label and notify the host to refetch bars. */
  setPeriod(period) {
    if (period == null) return;
    this.resolution = String(period);
    this.onPeriodChange?.(this.resolution);
    this._invalidate();
  }

  getPeriod() { return this.resolution; }

  // ── replay mode (FCS enableReplay) ─────────────────────────────────────────────────────

  /** Enter replay at a raw-bar index (default ~60% in). Only bars up to the cursor render. */
  enableReplay(startIndex = null) {
    const n = this.bars.length;
    if (!n) return;
    const i = startIndex == null ? Math.floor(n * 0.6) : startIndex;
    this.replayIndex = Math.max(0, Math.min(n - 1, i));
    this._upload();
    fitRight(this.vp, this.viewBars.length);
    clampRight(this.vp, this.viewBars.length);
    this._invalidate();
  }

  disableReplay() {
    if (this.replayIndex == null) return;
    this.replayIndex = null;
    this._upload();
    this._invalidate();
  }

  /** Move the replay cursor to a specific raw-bar index. */
  replaySeek(index) {
    if (this.replayIndex == null) return this.enableReplay(index);
    this.replayIndex = Math.max(0, Math.min(this.bars.length - 1, index));
    this._upload();
    this._invalidate();
  }

  /** Advance (or rewind) the replay cursor by `delta` bars. */
  replayStep(delta = 1) {
    if (this.replayIndex == null) return;
    this.replaySeek(this.replayIndex + delta);
  }

  getReplay() {
    return { enabled: this.replayIndex != null, index: this.replayIndex, total: this.bars.length };
  }

  /** Range-selector backing: size the viewport to show the most recent `n` bars. */
  showLastBars(n) {
    const plot = this._plot();
    if (n > 0 && plot.w > 0) this.vp.barSpace = Math.max(0.5, plot.w / n);
    fitRight(this.vp, this.viewBars.length);
    clampRight(this.vp, this.viewBars.length);
    this._invalidate();
  }

  /**
   * FCS exportImage: composite the GL + overlay canvases into a PNG data URL.
   * Renders synchronously first so the GL backbuffer holds the current frame
   * (the context uses preserveDrawingBuffer:false).
   */
  exportImage({ type = "image/png", background = null } = {}) {
    this._render();
    const w = this.glCanvas.width, h = this.glCanvas.height;
    if (!w || !h) return null;
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const ctx = out.getContext("2d");
    ctx.fillStyle = background || this.theme.bg || "#0b0e14";
    ctx.fillRect(0, 0, w, h);
    try {
      ctx.drawImage(this.glCanvas, 0, 0);
      ctx.drawImage(this.ovCanvas, 0, 0);
    } catch {
      return null;
    }
    return out.toDataURL(type);
  }

  /** Master synesthesia toggle — vol→temperature/haze, volume→mass, regime flash, provenance soft. */
  setSynesthesia(on) {
    this.synesthesia = !!on;
    if (!this.synesthesia) {
      this._synState = null;
    } else {
      this._sensoryDirty = true;
      this._uploadSensory();
    }
    this.onSynesthesiaChange?.(this.synesthesia);
    this._invalidate();
  }

  getSynesthesia() { return this.synesthesia; }

  /**
   * Sensory intensity dial: "gentle" | "balanced" | "vivid".
   * Gentle = steady metronome + soft gain (friendlier under sensory load).
   */
  setSensoryIntensity(name) {
    const key = String(name || "balanced").toLowerCase();
    this.sensoryIntensity = (key === "gentle" || key === "balanced" || key === "vivid")
      ? key
      : "balanced";
    this.onSensoryIntensityChange?.(this.sensoryIntensity);
    this._invalidate();
  }

  getSensoryIntensity() { return this.sensoryIntensity; }

  cycleSensoryIntensity() {
    const order = ["gentle", "balanced", "vivid"];
    const i = order.indexOf(this.sensoryIntensity);
    this.setSensoryIntensity(order[(i + 1) % order.length]);
    return this.sensoryIntensity;
  }

  /** Respect motion-governor tier: rich | reduced | minimal. */
  setMotionTier(tier) {
    this.motionTier = (tier === "reduced" || tier === "minimal") ? tier : "rich";
    this._invalidate();
  }

  getMotionTier() { return this.motionTier; }

  setLogScale(on) {
    this.vp.logScale = !!on;
    this._invalidate();
  }

  getLogScale() { return !!this.vp.logScale; }

  /** Add an indicator by catalog id (MA/EMA/BOLL/VWAP/RSI/MACD/ATR). */
  addIndicator(id, params = {}, opts = {}) {
    const inst = createIndicatorInstance(id, params, opts);
    if (!inst) return null;
    this.indicators.push(inst);
    this._recomputeIndicators();
    this.onIndicatorsChange?.(this.getIndicators());
    this._invalidate();
    return inst.uid;
  }

  removeIndicator(uid) {
    if (!uid) {
      this.indicators = [];
    } else {
      this.indicators = this.indicators.filter((i) => i.uid !== uid);
    }
    this._recomputeIndicators();
    this.onIndicatorsChange?.(this.getIndicators());
    this._invalidate();
  }

  setIndicatorVisible(uid, visible) {
    const ind = this.indicators.find((i) => i.uid === uid);
    if (!ind) return;
    ind.visible = !!visible;
    this._recomputeIndicators();
    this.onIndicatorsChange?.(this.getIndicators());
    this._invalidate();
  }

  getIndicators() {
    return this.indicators.map((i) => ({
      uid: i.uid, id: i.id, params: { ...i.params }, visible: i.visible !== false, color: i.color,
    }));
  }

  fitContent() {
    fitRight(this.vp, this.viewBars.length);
    clampRight(this.vp, this.viewBars.length);
    this._invalidate();
  }

  getViewState() {
    const { from, to } = visibleRange(this.vp);
    return { from, to, barSpace: this.vp.barSpace, right: this.vp.right };
  }

  // ── drawing tools ────────────────────────────────────────────────────────────────────

  /** Activate a drawing tool (`segment`|`horizontalStraightLine`|`rayLine`|`rect`|`fibonacciLine`),
   *  or pass null to return to navigate/inspect mode. */
  setTool(name) {
    if (name && !TOOLS[name]) throw new Error(`unknown tool: ${name}`);
    this.tool = name || null;
    this.draftPoints = [];
    this.draftCursor = null;
    this._dragHandle = null;
    this.onToolChange?.(this.tool);
    this._invalidate();
  }

  getTool() { return this.tool; }

  getDrawings() { return serializeDrawings(this.drawings); }

  setDrawings(raw) {
    this.drawings = deserializeDrawings(raw);
    this.selectedDrawingId = null;
    this._emitDrawings();
    this._invalidate();
  }

  removeDrawing(id) {
    if (!id) {
      this.drawings = [];
    } else {
      this.drawings = this.drawings.filter((d) => d.id !== id);
    }
    if (this.selectedDrawingId === id || !id) this.selectedDrawingId = null;
    this._emitDrawings();
    this._invalidate();
  }

  clearDrawings() { this.removeDrawing(null); }

  // ── horizontal-lines API (FCS parity) ──────────────────────────────────────────────────

  /** Add a horizontal price line. Returns its id. opts: { price, color, style, width, title }. */
  addHorizontalLine(opts = {}) {
    const price = +opts.price;
    if (!Number.isFinite(price)) return null;
    const id = opts.id || `hl_${Date.now().toString(36)}_${(++GlChart._hlSeq).toString(36)}`;
    this.priceLines.push({
      id,
      price,
      color: opts.color || this.theme.hLine?.color || "#e0a3ff",
      style: opts.style === "solid" ? "solid" : "dashed",
      width: Number.isFinite(opts.width) ? opts.width : 1,
      title: typeof opts.title === "string" ? opts.title : "",
    });
    this._invalidate();
    return id;
  }

  /** Patch an existing horizontal line by id (price/color/style/width/title). */
  updateHorizontalLine(id, patch = {}) {
    const line = this.priceLines.find((l) => l.id === id);
    if (!line) return false;
    if (patch.price != null && Number.isFinite(+patch.price)) line.price = +patch.price;
    if (patch.color != null) line.color = patch.color;
    if (patch.style != null) line.style = patch.style === "solid" ? "solid" : "dashed";
    if (patch.width != null && Number.isFinite(+patch.width)) line.width = +patch.width;
    if (patch.title != null) line.title = String(patch.title);
    this._invalidate();
    return true;
  }

  removeHorizontalLine(id) {
    const before = this.priceLines.length;
    this.priceLines = this.priceLines.filter((l) => l.id !== id);
    if (this.priceLines.length !== before) this._invalidate();
    return this.priceLines.length !== before;
  }

  getHorizontalLines() {
    return this.priceLines.map((l) => ({ ...l }));
  }

  clearHorizontalLines() {
    if (!this.priceLines.length) return;
    this.priceLines = [];
    this._invalidate();
  }

  /** Magnet-snap: while drawing, snap the anchor value to the nearest OHLC of the bar. */
  setMagnet(on) { this.magnet = !!on; }
  getMagnet() { return this.magnet; }

  // ── inspect ──────────────────────────────────────────────────────────────────────────

  /** Programmatically select a candle by index (or null to clear). */
  inspectBar(index) {
    if (index == null || index < 0 || index >= this.viewBars.length) {
      this.selectedIndex = null;
      this.onInspect?.(null);
    } else {
      this.selectedIndex = index;
      this.onInspect?.(this._inspectInfo(index));
    }
    this._invalidate();
  }

  getInspected() {
    return this.selectedIndex == null ? null : this._inspectInfo(this.selectedIndex);
  }

  // ── pointer logic ────────────────────────────────────────────────────────────────────

  _plotLocal(x, y) {
    if (x == null) return null;
    const p = this._plot();
    return {
      x: Math.min(p.w, Math.max(0, x - p.x)),
      y: Math.min(p.h, Math.max(0, y - p.y)),
      plot: p,
    };
  }

  _onPointerDown(x, y) {
    if (this.tool) return false;
    const loc = this._plotLocal(x, y);
    if (!loc) return false;
    const hit = hitTestDrawing(this.vp, this.viewBars, this.drawings, loc.x, loc.y, {
      handleRadius: this.theme.drawing.handleRadius + 4,
    });
    if (hit && hit.handleIndex >= 0) {
      this.selectedDrawingId = hit.drawingId;
      this._dragHandle = { drawingId: hit.drawingId, handleIndex: hit.handleIndex };
      return true; // capture — suppress pan
    }
    return false;
  }

  _onPointerMove(x, y) {
    const loc = this._plotLocal(x, y);
    if (!loc) { this.draftCursor = null; return; }

    if (this._dragHandle) {
      const anchor = plotToAnchor(this.vp, this.viewBars, loc.x, loc.y, { magnet: this.magnet });
      if (anchor) {
        const d = this.drawings.find((x) => x.id === this._dragHandle.drawingId);
        if (d) {
          d.points[this._dragHandle.handleIndex] = { t: anchor.t, value: anchor.value };
          this._emitDrawings();
        }
      }
      return;
    }

    if (this.tool) {
      this.draftCursor = plotToAnchor(this.vp, this.viewBars, loc.x, loc.y, { magnet: this.magnet });
    }
  }

  _onClick(x, y, mods) {
    const loc = this._plotLocal(x, y);
    if (!loc) return;

    if (this.tool) {
      const anchor = plotToAnchor(this.vp, this.viewBars, loc.x, loc.y, { magnet: this.magnet });
      if (!anchor) return;
      this.draftPoints.push({ t: anchor.t, value: anchor.value });
      const need = pointsNeeded(this.tool);
      if (this.draftPoints.length >= need) {
        const d = createDrawing(this.tool, this.draftPoints);
        this.drawings.push(d);
        this.selectedDrawingId = d.id;
        this.draftPoints = [];
        this.draftCursor = null;
        this._emitDrawings();
      }
      return;
    }

    // body-hit a drawing → select it (handles already claimed pointerDown)
    const hit = hitTestDrawing(this.vp, this.viewBars, this.drawings, loc.x, loc.y);
    if (hit) {
      this.selectedDrawingId = hit.drawingId;
      this.selectedIndex = null;
      this.onInspect?.(null);
      return;
    }

    const i = hitTestBar(this.vp, this.viewBars, loc.x);
    if (i >= 0) {
      this.selectedDrawingId = null;
      this.inspectBar(i);
    } else {
      this.selectedDrawingId = null;
      this.inspectBar(null);
    }
  }

  _cancelTool() {
    if (this.tool && this.draftPoints.length) {
      this.draftPoints = [];
      this.draftCursor = null;
      return;
    }
    if (this.tool) {
      this.setTool(null);
      return;
    }
    if (this.selectedDrawingId) {
      this.selectedDrawingId = null;
      return;
    }
    if (this.selectedIndex != null) this.inspectBar(null);
  }

  _onKey(key, e) {
    if (key === "Delete" || key === "Backspace") {
      if (this.selectedDrawingId) {
        e.preventDefault?.();
        this.removeDrawing(this.selectedDrawingId);
      }
    }
  }

  _inspectInfo(index) {
    const bar = this.viewBars[index];
    if (!bar) return null;
    const prev = index > 0 ? this.viewBars[index - 1] : null;
    return {
      index,
      bar: { ...bar },
      prev: prev ? { ...prev } : null,
      symbol: this.symbol,
      resolution: this.resolution,
      change: prev ? bar.c - prev.c : bar.c - bar.o,
      changePct: prev ? ((bar.c - prev.c) / prev.c) * 100 : ((bar.c - bar.o) / bar.o) * 100,
    };
  }

  _emitDrawings() {
    this.onDrawingsChange?.(this.getDrawings());
  }

  // ── internals ────────────────────────────────────────────────────────────────────────

  _plot() {
    const ax = this.theme.axis;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const fullH = Math.max(0, h - ax.bottomHeight);
    const paneH = paneStackHeight(this._indicatorCache, { plotH: fullH });
    return {
      x: 0,
      y: 0,
      w: Math.max(0, w - ax.rightWidth),
      h: Math.max(0, fullH - paneH),
      paneH,
      fullH,
    };
  }

  _atRightEdge() {
    const n = this.viewBars.length || this.bars.length;
    return !n || this.vp.right >= n - 1 - 0.5;
  }

  _recomputeIndicators() {
    this._indicatorCache = computeAllIndicators(this.viewBars, this.indicators);
  }

  _upload() {
    // Displayed series = active chart-type's transform of the raw bars (identity for base types).
    // In replay mode only raw bars up to the cursor are visible.
    const ct = getChartType(this.type);
    const raw = this.replayIndex != null ? this.bars.slice(0, this.replayIndex + 1) : this.bars;
    this.viewBars = ct?.transform ? ct.transform(raw) : raw;
    this._recomputeIndicators();
    if (!this.renderer) return;
    this.candles.setData(this.viewBars);
    this.volume.setData(this.viewBars);
    this.line.setData(this.viewBars);
    this.area.setData(this.viewBars);
    if (this.vpHeatOn) this.vpHeat.setData(this.viewBars);
    if (this.glowOn) this.glow.setData(this.viewBars);
    if (this.momentumOn) this.momentum.setData(this.viewBars);
    if (this.confidenceFanOn) this.confidenceFan.setData(this.viewBars);
    // Sensory GL buffers only when synesthesia is on (avoid thrash when off)
    if (this.synesthesia) this._uploadSensory();
    else this._sensoryDirty = true;
  }

  _uploadSensory() {
    if (!this.renderer || !this.synesthesia) return;
    this.gravity?.setData(this.viewBars);
    this.aurora?.setData(this.viewBars);
    this.vwapLeash?.setData(this.viewBars);
    this._sensoryDirty = false;
  }

  _resize() {
    if (this._disposed) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    const plot = this._plot();
    setSize(this.vp, plot.w, plot.h);
    const dpr = window.devicePixelRatio || 1;
    this.renderer?.resize(w, h, plot, dpr);
    this.overlay.resize(w, h, dpr);
    for (const c of [this.glCanvas, this.ovCanvas]) {
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    }
    this._invalidate();
  }

  _invalidate() {
    if (this._raf || this._disposed) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this._render();
    });
  }

  /** Animate when line/area heartbeat is on, or when synesthesia is painting any series. */
  _wantsPulse() {
    if (this.bars.length < 2) return false;
    if (this.synesthesia) {
      // motion-governor minimal → static (no continuous RAF from sensory alone)
      if (this.motionTier === "minimal") return false;
      if (this._synState?.animate === false) return false;
      return true;
    }
    return (this.type === "line" || this.type === "area")
      && this.theme.line?.heartbeat?.enabled !== false
      && this.motionTier !== "minimal";
  }

  _toolHint() {
    if (!this.tool) return null;
    const label = TOOLS[this.tool]?.label || this.tool;
    const need = pointsNeeded(this.tool);
    const have = this.draftPoints.length;
    return `Drawing ${label} · click ${need - have} more · Esc cancel`;
  }

  _render() {
    if (this._disposed) return;
    const bars = this.viewBars;
    const ct = getChartType(this.type);
    const base = ct?.base || this.type;
    const candleMode = ct?.candleMode || "normal";
    const plot = this._plot();
    setSize(this.vp, plot.w, plot.h);
    const volFrac = this.showVolume && (ct?.showsVolume ?? false)
      ? this.theme.volumeHeightFrac : 0;
    autoFitPrice(this.vp, bars, { volumeFrac: volFrac });

    // Also fit overlay indicator extremes into price domain when visible
    if (this.vp.autoPrice && this._indicatorCache.length) {
      this._expandPriceForOverlays();
    }

    const now = performance.now() * 0.001;
    const dt = this._synLastT ? Math.min(0.05, now - this._synLastT) : 1 / 60;
    this._synLastT = now;
    if (this.synesthesia) {
      if (this._sensoryDirty) this._uploadSensory();
      const prev = this._synState;
      const raw = computeSynesthesia(this.vp, bars, prev, dt);
      raw.bassHits = updateBassHits(this.vp, bars, prev?.bassHits, now);
      raw.sonicRing = updateSonicRing(bars, prev?.sonicRing, now);
      const cleared = applySensoryClarity(raw, this.sensoryIntensity, prev, this.motionTier);
      const psi = computePsionic(this.vp, bars, prev?.psi, dt, cleared);
      this._synState = applyPsionic(cleared, psi, this.sensoryIntensity);
    }

    if (this.renderer && bars.length) {
      this.renderer.beginFrame();
      if (this.vpHeatOn) this.vpHeat.draw(this.vp, this.theme);   // background heat, behind all
      const syn = this.synesthesia ? this._synState : null;
      const pulse = {
        time: now,
        enabled: this.synesthesia,
        heartbeatOnly: !this.synesthesia
          && this.theme.line?.heartbeat?.enabled !== false
          && this.motionTier !== "minimal",
        syn: this._synState,
        vol: this._synState?.vol ?? heartbeatIntensity(this.vp, bars),
      };
      if (syn) {
        this.aurora?.draw(this.vp, this.theme, syn, now);
        this.vwapLeash?.draw(this.vp, this.theme, syn);
        this.gravity?.draw(this.vp, this.theme, syn);
      }
      if (this.glowOn) this.glow.draw(this.vp, this.theme);       // additive bloom, behind series
      if (base === "candles") {
        if (this.showVolume && (ct?.showsVolume ?? true)) this.volume.draw(this.vp, this.theme);
        this.candles.draw(this.vp, this.theme, syn, { candleMode });
      } else if (base === "ohlc") {
        if (this.showVolume) this.volume.draw(this.vp, this.theme);
        // OHLC ticks painted on overlay (Canvas2D) — no GL path yet
      } else {
        if (base === "area") this.area.draw(this.vp, this.theme, pulse);
        // Echo trails — lagged heartbeat ghosts under the live stroke
        if (syn && (base === "line" || base === "area")) {
          const echoGain = syn.preset?.motion ?? 1;
          if (echoGain > 0.2 && this.motionTier !== "minimal") {
            for (const echo of [
              { dt: 0.22, a: 0.28 * echoGain, w: 0.72 },
              { dt: 0.44, a: 0.14 * echoGain, w: 0.55 },
            ]) {
              this.line.draw(this.vp, this.theme, {
                ...pulse,
                time: now - echo.dt,
                alphaMul: echo.a,
                widthMul: echo.w,
                echo: true,
              });
            }
          }
        }
        this.line.draw(this.vp, this.theme, pulse);
      }
      if (this.momentumOn) this.momentum.draw(this.vp, this.theme);       // momentum-hued line on top
      if (this.confidenceFanOn) this.confidenceFan.draw(this.vp, this.theme); // forward cone
    }

    const paneRect = plot.paneH > 0 ? {
      x: plot.x,
      y: plot.y + plot.h,
      w: plot.w,
      h: plot.paneH,
    } : null;

    this.overlay.draw({
      vp: this.vp,
      bars,
      theme: this.theme,
      plot,
      paneRect,
      cssWidth: this.container.clientWidth,
      cssHeight: this.container.clientHeight,
      symbol: this.symbol,
      resolution: this.resolution,
      cross: this.cross,
      selectedIndex: this.selectedIndex,
      drawings: this.drawings,
      priceLines: this.priceLines,
      selectedDrawingId: this.selectedDrawingId,
      synesthesia: this.synesthesia,
      syn: this._synState,
      sensoryIntensity: this.sensoryIntensity,
      indicators: this._indicatorCache,
      seriesType: base,
      nowSec: now,
      draft: this.tool ? {
        name: this.tool,
        points: this.draftPoints,
        cursor: this.draftCursor,
      } : null,
      toolHint: this._toolHint(),
    });

    if (this._wantsPulse()) this._invalidate();
  }

  _expandPriceForOverlays() {
    const { from, to } = visibleRange(this.vp);
    const i0 = Math.max(0, Math.floor(from));
    const i1 = Math.min(this.viewBars.length - 1, Math.ceil(to));
    let lo = this.vp.priceMin, hi = this.vp.priceMax;
    for (const ind of this._indicatorCache) {
      if (!ind.visible || ind.target !== "overlay" || !ind.series) continue;
      for (const key of ["mid", "upper", "lower"]) {
        const arr = ind.series[key];
        if (!arr) continue;
        for (let i = i0; i <= i1; i++) {
          const v = arr[i];
          if (!Number.isFinite(v)) continue;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
    }
    if (lo < this.vp.priceMin || hi > this.vp.priceMax) {
      const span = (hi - lo) || 1;
      const pad = span * 0.04;
      if (this.vp.logScale) {
        this.vp.priceMin = Math.max(1e-12, Math.min(this.vp.priceMin, lo));
        this.vp.priceMax = Math.max(this.vp.priceMax, hi);
      } else {
        this.vp.priceMin = Math.min(this.vp.priceMin, lo - pad);
        this.vp.priceMax = Math.max(this.vp.priceMax, hi + pad);
      }
    }
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    this._ro?.disconnect();
    this._detachInteraction?.();
    for (const s of [
      this.candles, this.volume, this.line, this.area,
      this.gravity, this.aurora, this.vwapLeash,
      this.vpHeat, this.glow, this.momentum, this.confidenceFan,
    ]) {
      try { s?.dispose?.(); } catch { /* ignore */ }
    }
    this.glCanvas?.remove();
    this.ovCanvas?.remove();
  }
}

GlChart._hlSeq = 0;

function mkCanvas(container, z) {
  const c = document.createElement("canvas");
  c.style.cssText = `position:absolute;inset:0;z-index:${z};display:block;`;
  container.appendChild(c);
  return c;
}
