// glcharts/overlay/overlay.js — the crisp-text layer over the GL canvas: grid, price/time axes,
// crosshair + labels, legend (symbol + hovered OHLCV), last-price line/pill. Canvas2D because
// axis-quality text in raw WebGL means an SDF atlas — planned for v1, not worth blocking v0.
// Redrawn per frame; at axis-label counts this is microseconds, the GL layer carries the load.

import { niceTicks, timeTicks, priceToY, indexToX, pricePrecisionFor, visibleRange } from "../core/viewport.js";
import { drawDrawings } from "../drawings/render.js";
import { drawSelection, drawInspectCard } from "./inspect.js";
import { paintSensoryOverlay } from "../series/sensoryExtras.js";
import { paintClarityOverlay } from "../series/sensoryClarity.js";
import { paintPsionicOverlay } from "../series/sensoryPsionic.js";
import {
  paintOverlayIndicators, paintPaneIndicators, paintOhlcBars,
} from "./indicatorsPaint.js";

export class Overlay {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  }

  resize(cssWidth, cssHeight, dpr = window.devicePixelRatio || 1) {
    const w = Math.max(1, Math.round(cssWidth * dpr));
    const h = Math.max(1, Math.round(cssHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.dpr = dpr;
  }

  /**
   * state: { vp, bars, theme, plot, cssWidth, cssHeight, symbol, resolution,
   *          cross, selectedIndex, drawings, selectedDrawingId, draft }
   */
  draw(state) {
    const { ctx } = this;
    const { vp, bars, theme, plot, cssWidth, cssHeight } = state;
    ctx.setTransform(this.dpr || 1, 0, 0, this.dpr || 1, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    if (!plot.w || !plot.h) return;

    const precision = pricePrecisionFor(bars[bars.length - 1]?.c);
    const priceTicks = niceTicks(vp.priceMin, vp.priceMax, Math.max(3, Math.round(plot.h / 60)));
    const tTicks = timeTicks(vp, bars);

    this._grid(state, priceTicks, tTicks);
    if (state.seriesType === "ohlc") {
      paintOhlcBars(ctx, { vp, bars, plot, theme });
    }
    if (state.indicators?.length) {
      paintOverlayIndicators(ctx, {
        vp, bars, plot, indicators: state.indicators,
      });
    }
    if (state.synesthesia && state.syn?.mist > 0.02) this._mist(state);
    if (state.synesthesia && state.syn) {
      paintClarityOverlay(ctx, {
        vp, bars, plot, theme, syn: state.syn,
        intensity: state.sensoryIntensity || "balanced",
      });
      paintSensoryOverlay(ctx, {
        vp, bars, plot, theme, syn: state.syn, nowSec: state.nowSec || 0,
      });
      paintPsionicOverlay(ctx, {
        vp, bars, plot, theme, syn: state.syn, nowSec: state.nowSec || 0,
      });
    }
    drawSelection(ctx, state);
    drawDrawings(ctx, state);
    if (state.paneRect && state.indicators?.length) {
      paintPaneIndicators(ctx, {
        vp, bars, paneRect: state.paneRect, indicators: state.indicators, theme,
      });
    }
    this._priceAxis(state, priceTicks, precision);
    this._timeAxis(state, tTicks);
    if (state.priceLines?.length) this._priceLines(state, precision);
    if (theme.lastPrice.line) this._lastPrice(state, precision);
    if (state.cross) this._crosshair(state, precision);
    this._legend(state, precision);
    drawInspectCard(ctx, state);
    if (state.toolHint) this._toolHint(state);
  }

  _toolHint({ theme, plot, toolHint }) {
    const { ctx } = this;
    ctx.save();
    ctx.font = theme.legend.font;
    ctx.fillStyle = theme.legend.muted;
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText(toolHint, plot.x + plot.w - 8, plot.y + 6);
    ctx.restore();
  }

  /** Soft heat/drawdown mist over the plot — density from syn.mist. */
  _mist({ theme, plot, syn }) {
    const { ctx } = this;
    const a = Math.min(0.22, (syn?.mist || 0) * 0.28);
    if (a < 0.01) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.x, plot.y, plot.w, plot.h);
    ctx.clip();
    const g = ctx.createLinearGradient(plot.x, plot.y, plot.x, plot.y + plot.h);
    const mist = theme.synesthesia?.mist || "rgba(255,122,89,0.07)";
    g.addColorStop(0, mist.replace(/[\d.]+\)$/, `${(a * 0.4).toFixed(3)})`));
    g.addColorStop(0.55, mist.replace(/[\d.]+\)$/, `${a.toFixed(3)})`));
    g.addColorStop(1, mist.replace(/[\d.]+\)$/, `${(a * 1.2).toFixed(3)})`));
    ctx.fillStyle = g;
    ctx.fillRect(plot.x, plot.y, plot.w, plot.h);
    ctx.restore();
  }

  _grid({ vp, theme, plot }, priceTicks, tTicks) {
    const { ctx } = this;
    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.x, plot.y, plot.w, plot.h);
    ctx.clip();
    ctx.strokeStyle = theme.grid.color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const p of priceTicks) {
      const y = Math.round(plot.y + priceToY(vp, p)) + 0.5;
      ctx.moveTo(plot.x, y);
      ctx.lineTo(plot.x + plot.w, y);
    }
    for (const { i } of tTicks) {
      const x = Math.round(plot.x + indexToX(vp, i)) + 0.5;
      ctx.moveTo(x, plot.y);
      ctx.lineTo(x, plot.y + plot.h);
    }
    ctx.stroke();
    ctx.restore();
  }

  _priceAxis({ vp, theme, plot }, priceTicks, precision) {
    const { ctx } = this;
    const ax = theme.axis;
    ctx.strokeStyle = ax.line;
    ctx.beginPath();
    ctx.moveTo(plot.x + plot.w + 0.5, plot.y);
    ctx.lineTo(plot.x + plot.w + 0.5, plot.y + plot.h);
    ctx.stroke();
    ctx.fillStyle = ax.text;
    ctx.font = ax.font;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (const p of priceTicks) {
      const y = plot.y + priceToY(vp, p);
      if (y < plot.y + 4 || y > plot.y + plot.h - 4) continue;
      ctx.fillText(fmtPrice(p, precision), plot.x + plot.w + 6, y);
    }
  }

  _timeAxis({ vp, theme, plot, resolution }, tTicks) {
    const { ctx } = this;
    const ax = theme.axis;
    ctx.strokeStyle = ax.line;
    ctx.beginPath();
    ctx.moveTo(plot.x, plot.y + plot.h + 0.5);
    ctx.lineTo(plot.x + plot.w, plot.y + plot.h + 0.5);
    ctx.stroke();
    ctx.fillStyle = ax.text;
    ctx.font = ax.font;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const { i, t } of tTicks) {
      const x = plot.x + indexToX(vp, i);
      if (x < plot.x + 10 || x > plot.x + plot.w - 10) continue;
      ctx.fillText(fmtTime(t, resolution), x, plot.y + plot.h + 5);
    }
  }

  /** FCS horizontal-lines API: full-width price lines with a right-axis pill + optional title. */
  _priceLines({ vp, theme, plot, priceLines }, precision) {
    const { ctx } = this;
    for (const line of priceLines) {
      const y = plot.y + priceToY(vp, line.price);
      if (y < plot.y - 0.5 || y > plot.y + plot.h + 0.5) continue;
      const yy = Math.round(y) + 0.5;
      ctx.save();
      ctx.strokeStyle = line.color;
      ctx.lineWidth = line.width || 1;
      ctx.setLineDash(line.style === "solid" ? [] : [6, 4]);
      ctx.beginPath();
      ctx.moveTo(plot.x, yy);
      ctx.lineTo(plot.x + plot.w, yy);
      ctx.stroke();
      ctx.setLineDash([]);
      if (line.title) {
        ctx.font = theme.legend.font;
        ctx.fillStyle = line.color;
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        ctx.fillText(line.title, plot.x + 6, yy - 3);
      }
      ctx.restore();
      this._pill(plot.x + plot.w + 2, y, fmtPrice(line.price, precision), line.color, "#0b0e14");
    }
  }

  _lastPrice({ vp, bars, theme, plot }, precision) {
    const { ctx } = this;
    const last = bars[bars.length - 1];
    if (!last) return;
    const y = plot.y + priceToY(vp, last.c);
    if (y < plot.y || y > plot.y + plot.h) return;
    const color = last.c >= last.o ? theme.up : theme.down;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.setLineDash(theme.lastPrice.dash);
    ctx.beginPath();
    ctx.moveTo(plot.x, Math.round(y) + 0.5);
    ctx.lineTo(plot.x + plot.w, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.restore();
    this._pill(plot.x + plot.w + 2, y, fmtPrice(last.c, precision), color, "#ffffff");
  }

  _crosshair({ vp, bars, theme, plot, cross, resolution }, precision) {
    const { ctx } = this;
    const ch = theme.crosshair;
    // snap x to the bar under the cursor
    const range = visibleRange(vp);
    const iRaw = range.to - (plot.w - cross.x) / vp.barSpace;
    const i = Math.round(Math.min(bars.length - 1, Math.max(0, iRaw)));
    const x = plot.x + indexToX(vp, i);
    const y = plot.y + cross.y;

    ctx.save();
    ctx.strokeStyle = ch.color;
    ctx.setLineDash(ch.dash);
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (x >= plot.x && x <= plot.x + plot.w) {
      ctx.moveTo(Math.round(x) + 0.5, plot.y);
      ctx.lineTo(Math.round(x) + 0.5, plot.y + plot.h);
    }
    ctx.moveTo(plot.x, Math.round(y) + 0.5);
    ctx.lineTo(plot.x + plot.w, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.restore();

    const priceAt = vp.priceMax - (cross.y / plot.h) * (vp.priceMax - vp.priceMin);
    this._pill(plot.x + plot.w + 2, y, fmtPrice(priceAt, precision), ch.labelBg, ch.labelText);
    const bar = bars[i];
    if (bar && x >= plot.x && x <= plot.x + plot.w) {
      this._pill(x, plot.y + plot.h + 2, fmtTime(bar.t, resolution, true), ch.labelBg, ch.labelText, "center");
    }
  }

  _legend({ vp, bars, theme, plot, cross, symbol }, precision) {
    const { ctx } = this;
    const lg = theme.legend;
    let bar = bars[bars.length - 1];
    if (cross) {
      const range = visibleRange(vp);
      const i = Math.round(range.to - (plot.w - cross.x) / vp.barSpace);
      if (i >= 0 && i < bars.length) bar = bars[i];
    }
    if (!bar) return;
    ctx.font = lg.font;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    let x = plot.x + 8;
    const y = plot.y + 6;
    const put = (txt, color) => {
      ctx.fillStyle = color;
      ctx.fillText(txt, x, y);
      x += ctx.measureText(txt).width + 8;
    };
    const dir = bar.c >= bar.o ? theme.up : theme.down;
    if (symbol) put(symbol, lg.text);
    put(`O ${fmtPrice(bar.o, precision)}`, lg.muted);
    put(`H ${fmtPrice(bar.h, precision)}`, lg.muted);
    put(`L ${fmtPrice(bar.l, precision)}`, lg.muted);
    put(`C ${fmtPrice(bar.c, precision)}`, dir);
    if (bar.v) put(`V ${fmtVol(bar.v)}`, lg.muted);
  }

  _pill(x, y, text, bg, fg, align = "left") {
    const { ctx } = this;
    const padX = 5, h = 16;
    const w = ctx.measureText(text).width + padX * 2;
    const bx = align === "center" ? x - w / 2 : x;
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(bx, y - (align === "center" ? 0 : h / 2), w, h, 3);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, bx + padX, y + (align === "center" ? h / 2 : 0));
  }
}

// ── formatting ─────────────────────────────────────────────────────────────────────────

function fmtPrice(p, precision) {
  return Number(p).toLocaleString("en-US", {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
}

function fmtVol(v) {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtTime(t, resolution = "1d", full = false) {
  const d = new Date(t * 1000);
  const intraday = /m|h/.test(resolution || "1d");
  if (full) {
    const date = `${MONTHS[d.getMonth()]} ${d.getDate()} '${String(d.getFullYear() % 100).padStart(2, "0")}`;
    if (!intraday) return date;
    return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  if (intraday) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.getMonth() === 0) return String(d.getFullYear());
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

const pad = (n) => String(n).padStart(2, "0");
