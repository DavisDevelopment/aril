// glcharts/overlay/inspect.js — candle selection highlight + detail card (Canvas2D).

import { indexToX, priceToY, pricePrecisionFor } from "../core/viewport.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function drawSelection(ctx, { vp, bars, plot, theme, selectedIndex }) {
  if (selectedIndex == null || selectedIndex < 0 || selectedIndex >= bars.length) return;
  const bar = bars[selectedIndex];
  const x = plot.x + indexToX(vp, selectedIndex);
  const half = Math.max(vp.barSpace * theme.bodyFrac * 0.5, 2);
  const yH = plot.y + priceToY(vp, bar.h);
  const yL = plot.y + priceToY(vp, bar.l);

  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.x, plot.y, plot.w, plot.h);
  ctx.clip();

  // vertical selection band
  ctx.fillStyle = theme.inspect.band;
  ctx.fillRect(x - half - 2, plot.y, half * 2 + 4, plot.h);

  // glow outline around the candle's high-low span
  ctx.strokeStyle = theme.inspect.outline;
  ctx.lineWidth = 2;
  ctx.strokeRect(x - half - 1.5, yH - 2, half * 2 + 3, Math.max(4, yL - yH + 4));
  ctx.restore();
}

/**
 * Floating detail card anchored near the selected candle. Avoids going off-plot.
 * Returns the card's screen rect (plot-absolute) so the interaction layer can treat
 * clicks inside it as "consumed" if needed later.
 */
export function drawInspectCard(ctx, {
  vp, bars, plot, theme, selectedIndex, symbol, resolution,
}) {
  if (selectedIndex == null || selectedIndex < 0 || selectedIndex >= bars.length) return null;
  const bar = bars[selectedIndex];
  const prev = selectedIndex > 0 ? bars[selectedIndex - 1] : null;
  const precision = pricePrecisionFor(bar.c);
  const change = prev ? bar.c - prev.c : bar.c - bar.o;
  const changePct = prev ? (change / prev.c) * 100 : ((bar.c - bar.o) / bar.o) * 100;
  const dir = change >= 0 ? theme.up : theme.down;

  const rows = [
    ["Time", fmtTime(bar.t, resolution, true)],
    ["Open", fmtPrice(bar.o, precision)],
    ["High", fmtPrice(bar.h, precision)],
    ["Low", fmtPrice(bar.l, precision)],
    ["Close", fmtPrice(bar.c, precision)],
    ["Change", `${change >= 0 ? "+" : ""}${fmtPrice(change, precision)} (${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%)`],
    ["Volume", fmtVol(bar.v)],
    ["Bar #", String(selectedIndex + 1)],
  ];

  const pad = 10;
  const lineH = 16;
  const titleH = 20;
  const cardW = 210;
  const cardH = pad * 2 + titleH + rows.length * lineH;

  const cx = plot.x + indexToX(vp, selectedIndex);
  let cardX = cx + Math.max(vp.barSpace, 8) + 8;
  let cardY = plot.y + 28;
  if (cardX + cardW > plot.x + plot.w - 4) cardX = cx - cardW - Math.max(vp.barSpace, 8) - 8;
  if (cardX < plot.x + 4) cardX = plot.x + 4;
  if (cardY + cardH > plot.y + plot.h - 4) cardY = plot.y + plot.h - cardH - 4;

  // shadow + body
  ctx.save();
  ctx.fillStyle = theme.inspect.cardShadow;
  ctx.beginPath();
  ctx.roundRect(cardX + 2, cardY + 3, cardW, cardH, 6);
  ctx.fill();
  ctx.fillStyle = theme.inspect.cardBg;
  ctx.strokeStyle = theme.inspect.cardBorder;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(cardX, cardY, cardW, cardH, 6);
  ctx.fill();
  ctx.stroke();

  // accent bar on the left
  ctx.fillStyle = dir;
  ctx.fillRect(cardX, cardY + 6, 3, cardH - 12);

  ctx.font = theme.inspect.titleFont;
  ctx.fillStyle = theme.legend.text;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const title = symbol ? `${symbol}` : "Candle";
  ctx.fillText(title, cardX + pad + 4, cardY + pad - 2);

  ctx.font = theme.inspect.bodyFont;
  let y = cardY + pad + titleH;
  for (const [k, v] of rows) {
    ctx.fillStyle = theme.legend.muted;
    ctx.fillText(k, cardX + pad + 4, y);
    ctx.fillStyle = k === "Change" || k === "Close" ? dir : theme.legend.text;
    ctx.textAlign = "right";
    ctx.fillText(v, cardX + cardW - pad, y);
    ctx.textAlign = "left";
    y += lineH;
  }
  ctx.restore();
  return { x: cardX, y: cardY, w: cardW, h: cardH };
}

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

function fmtTime(t, resolution = "1d", full = false) {
  const d = new Date(t * 1000);
  const intraday = /m|h/.test(resolution || "1d");
  const date = `${MONTHS[d.getMonth()]} ${d.getDate()} '${String(d.getFullYear() % 100).padStart(2, "0")}`;
  if (!full) return intraday ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : date;
  if (!intraday) return date;
  return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const pad = (n) => String(n).padStart(2, "0");
