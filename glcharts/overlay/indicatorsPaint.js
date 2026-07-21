// glcharts/overlay/indicatorsPaint.js — Canvas2D paint for Advanced indicator overlays + panes.

import { visibleRange, indexToX, priceToY } from "../core/viewport.js";

/**
 * Paint price-pane overlays (MA/EMA/BOLL/VWAP) into the main plot.
 */
export function paintOverlayIndicators(ctx, { vp, bars, plot, indicators = [] }) {
  if (!bars?.length || !indicators?.length) return;
  const { from, to } = visibleRange(vp);
  const i0 = Math.max(0, Math.floor(from));
  const i1 = Math.min(bars.length - 1, Math.ceil(to));
  if (i1 < i0) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.x, plot.y, plot.w, plot.h);
  ctx.clip();

  for (const ind of indicators) {
    if (!ind.visible || ind.target !== "overlay" || !ind.series) continue;
    const color = ind.color || "#4f8ff7";
    if (ind.series.upper && ind.series.lower) {
      paintBand(ctx, {
        vp, plot, i0, i1,
        upper: ind.series.upper,
        lower: ind.series.lower,
        color,
      });
    }
    if (ind.series.mid) {
      paintPolyline(ctx, {
        vp, plot, i0, i1,
        values: ind.series.mid,
        color,
        width: 1.35,
      });
    }
  }
  ctx.restore();
}

/**
 * Paint stacked pane indicators under the main plot.
 * `paneRect` is the full band reserved for panes (below main plot).
 * Returns nothing; lays out panes top→bottom.
 */
export function paintPaneIndicators(ctx, {
  vp, bars, paneRect, indicators = [], theme,
}) {
  if (!bars?.length || !paneRect?.h || !indicators?.length) return;
  const panes = indicators.filter((i) => i.visible && i.target === "pane" && i.series);
  if (!panes.length) return;

  const { from, to } = visibleRange(vp);
  const i0 = Math.max(0, Math.floor(from));
  const i1 = Math.min(bars.length - 1, Math.ceil(to));
  if (i1 < i0) return;

  const totalReq = panes.reduce((s, p) => s + (p.paneHeight || 72), 0) || 1;
  let y = paneRect.y;
  const gap = 1;

  ctx.save();
  for (const ind of panes) {
    const frac = (ind.paneHeight || 72) / totalReq;
    const h = Math.max(28, paneRect.h * frac - gap);
    const rect = { x: paneRect.x, y, w: paneRect.w, h };
    paintPaneChrome(ctx, { rect, theme, label: paneLabel(ind) });
    paintPaneSeries(ctx, { vp, bars, rect, ind, i0, i1, theme });
    y += h + gap;
  }
  ctx.restore();
}

function paneLabel(ind) {
  const p = ind.params || {};
  if (ind.id === "MACD") return `MACD ${p.fast}/${p.slow}/${p.sig}`;
  if (ind.id === "RSI") return `RSI ${p.n}`;
  if (ind.id === "ATR") return `ATR ${p.n}`;
  return ind.def?.name || ind.id;
}

function paintPaneChrome(ctx, { rect, theme, label }) {
  const ax = theme.axis || {};
  ctx.strokeStyle = ax.line || "rgba(139,147,167,0.25)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(rect.x, Math.round(rect.y) + 0.5);
  ctx.lineTo(rect.x + rect.w, Math.round(rect.y) + 0.5);
  ctx.stroke();
  ctx.font = theme.legend?.font || ax.font || "500 11px 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace";
  ctx.fillStyle = theme.legend?.muted || ax.text || "#8b93a7";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(label, rect.x + 6, rect.y + 4);
}

function paintPaneSeries(ctx, { vp, rect, ind, i0, i1, theme }) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();

  const series = ind.series;
  const color = ind.color || "#c4a1ff";

  if (ind.id === "MACD" && series.hist) {
    const { lo, hi } = seriesExtent([series.hist, series.mid, series.signal], i0, i1);
    paintHist(ctx, { vp, rect, values: series.hist, i0, i1, lo, hi, up: theme.up, down: theme.down });
    paintPaneLine(ctx, { vp, rect, values: series.mid, i0, i1, lo, hi, color, width: 1.2 });
    paintPaneLine(ctx, {
      vp, rect, values: series.signal, i0, i1, lo, hi,
      color: theme.synesthesia?.cool || "#5b8def", width: 1,
    });
    paintZero(ctx, { rect, lo, hi });
  } else if (series.mid) {
    const fixed = series.range;
    const ext = fixed
      ? { lo: fixed[0], hi: fixed[1] }
      : seriesExtent([series.mid], i0, i1);
    if (series.guides) {
      for (const g of series.guides) {
        paintGuide(ctx, { rect, lo: ext.lo, hi: ext.hi, value: g, color: "rgba(139,147,167,0.35)" });
      }
    }
    paintPaneLine(ctx, {
      vp, rect, values: series.mid, i0, i1, lo: ext.lo, hi: ext.hi, color, width: 1.35,
    });
  }
  ctx.restore();
}

function seriesExtent(arrays, i0, i1) {
  let lo = Infinity, hi = -Infinity;
  for (const arr of arrays) {
    if (!arr) continue;
    for (let i = i0; i <= i1; i++) {
      const v = arr[i];
      if (!Number.isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { lo: -1, hi: 1 };
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.08;
  return { lo: lo - pad, hi: hi + pad };
}

function valueToY(rect, lo, hi, v) {
  const span = hi - lo || 1;
  return rect.y + rect.h * (1 - (v - lo) / span);
}

function paintPaneLine(ctx, { vp, rect, values, i0, i1, lo, hi, color, width }) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  let started = false;
  for (let i = i0; i <= i1; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) { started = false; continue; }
    const x = rect.x + indexToX(vp, i);
    const y = valueToY(rect, lo, hi, v);
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function paintHist(ctx, { vp, rect, values, i0, i1, lo, hi, up, down }) {
  const zeroY = valueToY(rect, lo, hi, 0);
  const w = Math.max(1, vp.barSpace * 0.55);
  for (let i = i0; i <= i1; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    const x = rect.x + indexToX(vp, i);
    const y = valueToY(rect, lo, hi, v);
    ctx.fillStyle = v >= 0 ? (up || "#2dbd85") : (down || "#f6465d");
    ctx.globalAlpha = 0.55;
    const top = Math.min(y, zeroY);
    const h = Math.max(1, Math.abs(y - zeroY));
    ctx.fillRect(x - w / 2, top, w, h);
  }
  ctx.globalAlpha = 1;
}

function paintZero(ctx, { rect, lo, hi }) {
  if (lo > 0 || hi < 0) return;
  const y = Math.round(valueToY(rect, lo, hi, 0)) + 0.5;
  ctx.strokeStyle = "rgba(139,147,167,0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(rect.x, y);
  ctx.lineTo(rect.x + rect.w, y);
  ctx.stroke();
}

function paintGuide(ctx, { rect, lo, hi, value, color }) {
  const y = Math.round(valueToY(rect, lo, hi, value)) + 0.5;
  ctx.strokeStyle = color;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(rect.x, y);
  ctx.lineTo(rect.x + rect.w, y);
  ctx.stroke();
  ctx.setLineDash([]);
}

function paintPolyline(ctx, { vp, plot, i0, i1, values, color, width }) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  let started = false;
  for (let i = i0; i <= i1; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) { started = false; continue; }
    const x = plot.x + indexToX(vp, i);
    const y = plot.y + priceToY(vp, v);
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function paintBand(ctx, { vp, plot, i0, i1, upper, lower, color }) {
  ctx.beginPath();
  let started = false;
  for (let i = i0; i <= i1; i++) {
    if (!Number.isFinite(upper[i])) { started = false; continue; }
    const x = plot.x + indexToX(vp, i);
    const y = plot.y + priceToY(vp, upper[i]);
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  }
  for (let i = i1; i >= i0; i--) {
    if (!Number.isFinite(lower[i])) continue;
    const x = plot.x + indexToX(vp, i);
    const y = plot.y + priceToY(vp, lower[i]);
    ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.08;
  ctx.fill();
  ctx.globalAlpha = 1;
  paintPolyline(ctx, { vp, plot, i0, i1, values: upper, color, width: 1 });
  paintPolyline(ctx, { vp, plot, i0, i1, values: lower, color, width: 1 });
}

/** Optional OHLC tick marks when series type is "ohlc" (Canvas2D fallback). */
export function paintOhlcBars(ctx, { vp, bars, plot, theme }) {
  if (!bars?.length) return;
  const { from, to } = visibleRange(vp);
  const i0 = Math.max(0, Math.floor(from));
  const i1 = Math.min(bars.length - 1, Math.ceil(to));
  const tick = Math.max(2, vp.barSpace * 0.35);
  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.x, plot.y, plot.w, plot.h);
  ctx.clip();
  ctx.lineWidth = 1.25;
  for (let i = i0; i <= i1; i++) {
    const b = bars[i];
    if (!b) continue;
    const x = plot.x + indexToX(vp, i);
    const yO = plot.y + priceToY(vp, b.o);
    const yH = plot.y + priceToY(vp, b.h);
    const yL = plot.y + priceToY(vp, b.l);
    const yC = plot.y + priceToY(vp, b.c);
    const up = b.c >= b.o;
    ctx.strokeStyle = up ? theme.up : theme.down;
    ctx.beginPath();
    ctx.moveTo(x, yH);
    ctx.lineTo(x, yL);
    ctx.moveTo(x - tick, yO);
    ctx.lineTo(x, yO);
    ctx.moveTo(x, yC);
    ctx.lineTo(x + tick, yC);
    ctx.stroke();
  }
  ctx.restore();
}
