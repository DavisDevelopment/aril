// glcharts/series/candles.js — instanced candlestick renderer: 2 draw calls total
// (bodies then wicks) regardless of bar count. Instance layout comes from
// geometry.buildCandleInstances; the base quad is synthesized from gl_VertexID (no VBO).
//
// Chart-type variants (FCS-superset P1) are driven by draw(...opts.candleMode):
//   "normal"    — filled bodies + wicks (default)
//   "wicksOnly" — high-low range lines only, no bodies (High-Low chart type)
//   "hollow"    — up bars outlined (interior discarded), down bars filled (Hollow Candles)
//   "volume"    — body width scales with per-bar volume (Volume Candles)
// The stride-5 instance buffer is unchanged; per-bar normalized volume rides a parallel buffer.

import { PROJ_GLSL } from "../core/renderer.js";
import { buildCandleInstances } from "./geometry.js";
import { parseColor } from "../theme.js";

const VS = `#version 300 es
precision highp float;
${PROJ_GLSL}
uniform float u_mode;       // 0 = body (o->c), 1 = wick (l->h)
uniform float u_bodyFrac;   // body width fraction of one bar slot
uniform float u_wickPx;     // wick width, CSS px
uniform float u_minBodyPx;  // doji floor
uniform float u_volMode;    // 1 = scale body width by a_vol
uniform float u_volMin;     // min body-width fraction at zero volume
in float a_idx;
in vec4  a_ohlc;            // o h l c
in float a_vol;            // normalized volume 0..1 (for volume candles)
out float v_dir;
out vec2  v_corner;
out float v_halfPx;
out float v_heightPx;

void main() {
  // unit-quad corner from gl_VertexID: (0,0)(1,0)(0,1)(1,1) as a triangle strip
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  v_corner = corner;
  float o = a_ohlc.x, h = a_ohlc.y, l = a_ohlc.z, c = a_ohlc.w;
  v_dir = c >= o ? 1.0 : -1.0;

  float xc = idxToPx(a_idx);
  float widthScale = u_volMode > 0.5 ? mix(u_volMin, 1.0, clamp(a_vol, 0.0, 1.0)) : 1.0;
  float halfW = u_mode < 0.5
    ? max(u_bodyFrac * u_barSpace * 0.5 * widthScale, 0.5)
    : u_wickPx * 0.5;

  float yA, yB;
  if (u_mode < 0.5) {
    yA = priceToPx(max(o, c));
    yB = priceToPx(min(o, c));
    if (yB - yA < u_minBodyPx) { float m = (yA + yB) * 0.5; yA = m - u_minBodyPx * 0.5; yB = m + u_minBodyPx * 0.5; }
  } else {
    yA = priceToPx(h);
    yB = priceToPx(l);
  }
  v_halfPx = halfW;
  v_heightPx = abs(yB - yA);
  vec2 px = vec2(xc - halfW + corner.x * halfW * 2.0, mix(yA, yB, corner.y));
  gl_Position = vec4(pxToClip(px), 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
uniform vec4 u_up;
uniform vec4 u_down;
uniform float u_mode;      // 0 = body, 1 = wick
uniform float u_hollow;    // 1 = up bars outlined (interior discarded)
uniform float u_borderPx;  // outline thickness for hollow bodies
in float v_dir;
in vec2  v_corner;
in float v_halfPx;
in float v_heightPx;
out vec4 outColor;
void main() {
  vec4 col = v_dir > 0.0 ? u_up : u_down;
  // Hollow: outline up bodies only. Down bodies + all wicks stay solid.
  if (u_hollow > 0.5 && u_mode < 0.5 && v_dir > 0.0) {
    float dx = min(v_corner.x, 1.0 - v_corner.x) * (v_halfPx * 2.0);
    float dy = min(v_corner.y, 1.0 - v_corner.y) * v_heightPx;
    if (min(dx, dy) > u_borderPx) discard; // interior → hollow
  }
  outColor = col;
}`;

export class CandleSeries {
  constructor(renderer) {
    this.r = renderer;
    const { gl } = renderer;
    this.entry = renderer.program("candles", VS, FS);
    this.count = 0;
    this.buf = gl.createBuffer();
    this.volBuf = gl.createBuffer();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const stride = 5 * 4;
    const aIdx = gl.getAttribLocation(this.entry.prog, "a_idx");
    const aOhlc = gl.getAttribLocation(this.entry.prog, "a_ohlc");
    gl.enableVertexAttribArray(aIdx);
    gl.vertexAttribPointer(aIdx, 1, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(aIdx, 1);
    gl.enableVertexAttribArray(aOhlc);
    gl.vertexAttribPointer(aOhlc, 4, gl.FLOAT, false, stride, 4);
    gl.vertexAttribDivisor(aOhlc, 1);
    // parallel per-instance normalized volume buffer (for volume candles)
    this.aVol = gl.getAttribLocation(this.entry.prog, "a_vol");
    if (this.aVol >= 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.volBuf);
      gl.enableVertexAttribArray(this.aVol);
      gl.vertexAttribPointer(this.aVol, 1, gl.FLOAT, false, 4, 0);
      gl.vertexAttribDivisor(this.aVol, 1);
    }
    gl.bindVertexArray(null);
  }

  setData(bars) {
    const { gl } = this.r;
    const data = buildCandleInstances(bars);
    this.count = bars.length;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    // Normalized volume (0..1) for volume-candle width; cheap, always kept fresh.
    const vol = new Float32Array(bars.length);
    let vMax = 0;
    for (let i = 0; i < bars.length; i++) { const v = bars[i].v || 0; if (v > vMax) vMax = v; }
    const inv = vMax > 0 ? 1 / vMax : 0;
    for (let i = 0; i < bars.length; i++) vol[i] = (bars[i].v || 0) * inv;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.volBuf);
    gl.bufferData(gl.ARRAY_BUFFER, vol, gl.DYNAMIC_DRAW);
  }

  /** opts.candleMode: "normal"|"wicksOnly"|"hollow"|"volume". */
  draw(vp, theme, syn = null, opts = {}) {
    if (!this.count) return;
    const mode = opts.candleMode || "normal";
    const { gl } = this.r;
    const e = this.entry;
    gl.useProgram(e.prog);
    this.r.setProjection(e, vp);
    gl.uniform1f(e.loc("u_bodyFrac"), theme.bodyFrac);
    // Soft provenance → slightly thicker, less needle-like wicks
    const soft = syn ? clamp01(syn.soft) : 0;
    gl.uniform1f(e.loc("u_wickPx"), theme.wickPx * (1 - 0.45 * soft) + 0.35 * soft);
    gl.uniform1f(e.loc("u_minBodyPx"), theme.minBodyPx);
    gl.uniform1f(e.loc("u_hollow"), mode === "hollow" ? 1 : 0);
    gl.uniform1f(e.loc("u_borderPx"), theme.hollowBorderPx || 1.25);
    gl.uniform1f(e.loc("u_volMode"), mode === "volume" ? 1 : 0);
    gl.uniform1f(e.loc("u_volMin"), theme.volCandleMinFrac || 0.18);
    gl.bindVertexArray(this.vao);

    let up = parseColor(theme.wickUp);
    let down = parseColor(theme.wickDown);
    let upB = parseColor(theme.up);
    let downB = parseColor(theme.down);
    if (syn) {
      // Temperature gently warms both sides when vol is high (shared climate).
      const warm = parseColor(theme.synesthesia?.warm || "#ff7a59");
      const t = clamp01(syn.temp) * 0.28;
      up = mix4(up, warm, t * 0.5);
      down = mix4(down, warm, t * 0.5);
      upB = mix4(upB, warm, t);
      downB = mix4(downB, warm, t);
      if (syn.regimeFlash > 0.05) {
        const reg = parseColor(theme.synesthesia?.regimeHue || "#c4a1ff");
        const f = syn.regimeFlash * 0.35;
        upB = mix4(upB, reg, f);
        downB = mix4(downB, reg, f);
      }
    }

    // wick pass (l->h). Always drawn; for wicksOnly it's the whole chart.
    gl.uniform4fv(e.loc("u_up"), up);
    gl.uniform4fv(e.loc("u_down"), down);
    gl.uniform1f(e.loc("u_mode"), 1);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);

    // body pass (o->c). Skipped for High-Low (wicksOnly).
    if (mode !== "wicksOnly") {
      gl.uniform4fv(e.loc("u_up"), upB);
      gl.uniform4fv(e.loc("u_down"), downB);
      gl.uniform1f(e.loc("u_mode"), 0);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
    }
    gl.bindVertexArray(null);
  }

  dispose() {
    const { gl } = this.r;
    gl.deleteBuffer(this.buf);
    gl.deleteBuffer(this.volBuf);
    gl.deleteVertexArray(this.vao);
  }
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
function mix4(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t,
  ];
}
