// glcharts/drawings/render.js — Canvas2D painter for completed + in-progress drawings.
// Called from Overlay after the grid so drawings sit above candles (GL) and under the crosshair.

import { FIB_LEVELS, TOOLS } from "./tools.js";
import { anchorToPlot } from "../interact/hitTest.js";

export function drawDrawings(ctx, {
  vp, bars, plot, theme, drawings = [], selectedId = null,
  draft = null, // { name, points: Anchor[], cursor: Anchor|null }
}) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.x, plot.y, plot.w, plot.h);
  ctx.clip();

  for (const d of drawings) {
    paintOne(ctx, d, {
      vp, bars, plot, theme,
      selected: d.id === selectedId,
    });
  }

  if (draft?.name && draft.points?.length) {
    const pts = [...draft.points];
    if (draft.cursor) pts.push(draft.cursor);
    paintOne(ctx, { name: draft.name, points: pts, styles: null }, {
      vp, bars, plot, theme, selected: true, draft: true,
    });
  }
  ctx.restore();
}

function paintOne(ctx, drawing, { vp, bars, plot, theme, selected, draft }) {
  const tool = TOOLS[drawing.name];
  if (!tool) return;
  const color = drawing.styles?.color || theme.drawing.color;
  const width = drawing.styles?.width || theme.drawing.width;
  const pts = (drawing.points || [])
    .map((p) => {
      const a = anchorToPlot(vp, bars, p);
      return a ? { x: plot.x + a.x, y: plot.y + a.y } : null;
    })
    .filter(Boolean);
  if (!pts.length) return;

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = selected ? width + 0.5 : width;
  ctx.setLineDash(draft ? [5, 4] : []);
  ctx.globalAlpha = draft ? 0.85 : 1;

  switch (drawing.name) {
    case "segment":
      if (pts.length >= 2) strokeLine(ctx, pts[0], pts[1]);
      break;
    case "horizontalStraightLine": {
      const y = pts[0].y;
      strokeLine(ctx, { x: plot.x, y }, { x: plot.x + plot.w, y });
      break;
    }
    case "rayLine":
      if (pts.length >= 2) strokeRay(ctx, pts[0], pts[1], plot);
      break;
    case "rect":
      if (pts.length >= 2) {
        const x = Math.min(pts[0].x, pts[1].x);
        const y = Math.min(pts[0].y, pts[1].y);
        const w = Math.abs(pts[1].x - pts[0].x);
        const h = Math.abs(pts[1].y - pts[0].y);
        ctx.globalAlpha = draft ? 0.15 : 0.08;
        ctx.fillRect(x, y, w, h);
        ctx.globalAlpha = draft ? 0.85 : 1;
        ctx.strokeRect(x + 0.5, y + 0.5, w, h);
      }
      break;
    case "fibonacciLine":
      if (pts.length >= 2) paintFib(ctx, pts[0], pts[1], plot, theme, color);
      break;
    case "verticalStraightLine": {
      const x = pts[0].x;
      strokeLine(ctx, { x, y: plot.y }, { x, y: plot.y + plot.h });
      break;
    }
    case "horizontalSegment":
      if (pts.length >= 2) {
        const y = pts[0].y;
        strokeLine(ctx, { x: pts[0].x, y }, { x: pts[1].x, y });
      }
      break;
    case "parallelStraightLine":
      if (pts.length >= 2) {
        strokeLine(ctx, pts[0], pts[1]);
        if (pts.length >= 3) {
          const dx = pts[1].x - pts[0].x;
          const dy = pts[1].y - pts[0].y;
          const p2 = { x: pts[2].x + dx, y: pts[2].y + dy };
          strokeLine(ctx, pts[2], p2);
          // translucent channel fill
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          ctx.lineTo(pts[1].x, pts[1].y);
          ctx.lineTo(p2.x, p2.y);
          ctx.lineTo(pts[2].x, pts[2].y);
          ctx.closePath();
          ctx.globalAlpha = draft ? 0.12 : 0.06;
          ctx.fill();
          ctx.globalAlpha = draft ? 0.85 : 1;
        }
      }
      break;
    case "abcd":
      if (pts.length >= 2) {
        for (let i = 0; i < pts.length - 1; i++) strokeLine(ctx, pts[i], pts[i + 1]);
        ctx.font = theme.axis.font;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillStyle = color;
        const labels = ["A", "B", "C", "D"];
        for (let i = 0; i < pts.length; i++) ctx.fillText(labels[i] || "", pts[i].x, pts[i].y - 6);
      }
      break;
    case "annotation": {
      const p = pts[0];
      const text = drawing.styles?.text || "Note";
      // pin marker
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
      // label chip
      ctx.font = theme.legend.font;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const padX = 5, h = 16;
      const w = ctx.measureText(text).width + padX * 2;
      ctx.globalAlpha = draft ? 0.7 : 0.92;
      ctx.fillStyle = theme.legend.chipBg || "rgba(20,24,33,0.9)";
      ctx.beginPath();
      ctx.roundRect(p.x + 8, p.y - h / 2, w, h, 3);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.fillText(text, p.x + 8 + padX, p.y);
      break;
    }
    default:
      break;
  }

  ctx.setLineDash([]);
  // handles
  if (selected || draft) {
    for (const p of pts) paintHandle(ctx, p, theme);
  }
  ctx.globalAlpha = 1;
}

function paintFib(ctx, a, b, plot, theme, color) {
  ctx.font = theme.axis.font;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  for (const lvl of FIB_LEVELS) {
    const y = a.y + (b.y - a.y) * lvl;
    ctx.strokeStyle = color;
    ctx.globalAlpha = lvl === 0 || lvl === 1 ? 1 : 0.55;
    ctx.beginPath();
    ctx.moveTo(plot.x, Math.round(y) + 0.5);
    ctx.lineTo(plot.x + plot.w, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = color;
    ctx.fillText(`${(lvl * 100).toFixed(1)}%`, plot.x + 4, y - 2);
  }
  ctx.globalAlpha = 0.5;
  strokeLine(ctx, a, b);
  ctx.globalAlpha = 1;
}

function strokeLine(ctx, a, b) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function strokeRay(ctx, a, b, plot) {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return;
  // extend far past B to the plot edge
  const scale = 4000 / Math.max(Math.hypot(dx, dy), 1e-6);
  const end = { x: a.x + dx * scale, y: a.y + dy * scale };
  strokeLine(ctx, a, end);
}

function paintHandle(ctx, p, theme) {
  const r = theme.drawing.handleRadius;
  ctx.beginPath();
  ctx.fillStyle = theme.drawing.handleFill;
  ctx.strokeStyle = theme.drawing.handleStroke;
  ctx.lineWidth = 1.5;
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}
