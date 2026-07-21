// glcharts/series/vwapLeash.js — VWAP spine + magnetic leash threads from close → VWAP.

import { PROJ_GLSL } from "../core/renderer.js";
import { buildVwap, buildVwapLeash } from "./sensoryExtras.js";
import { buildLineStrip } from "./geometry.js";
import { parseColor } from "../theme.js";

const LINE_VS = `#version 300 es
precision highp float;
${PROJ_GLSL}
uniform float u_widthPx;
in vec2 a_pos;
in vec2 a_prev;
in vec2 a_next;
in float a_side;
void main() {
  vec2 p  = vec2(idxToPx(a_pos.x),  priceToPx(a_pos.y));
  vec2 pp = vec2(idxToPx(a_prev.x), priceToPx(a_prev.y));
  vec2 pn = vec2(idxToPx(a_next.x), priceToPx(a_next.y));
  vec2 dirIn = p - pp; vec2 dirOut = pn - p;
  if (dot(dirIn, dirIn) < 1e-12) dirIn = dirOut;
  if (dot(dirOut, dirOut) < 1e-12) dirOut = dirIn;
  vec2 tangent = normalize(normalize(dirIn) + normalize(dirOut));
  vec2 normal = vec2(-tangent.y, tangent.x);
  float miter = 1.0 / max(dot(normal, vec2(-normalize(dirIn).y, normalize(dirIn).x)), 0.35);
  vec2 px = p + normal * a_side * u_widthPx * 0.5 * miter;
  gl_Position = vec4(pxToClip(px), 0.0, 1.0);
}`;

const LEASH_VS = `#version 300 es
precision highp float;
${PROJ_GLSL}
in vec2 a_pt; // idx, price
void main() {
  gl_Position = vec4(pxToClip(vec2(idxToPx(a_pt.x), priceToPx(a_pt.y))), 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 outColor;
void main() { outColor = u_color; }`;

export class VwapLeashSeries {
  constructor(renderer) {
    this.r = renderer;
    const { gl } = renderer;
    this.lineEntry = renderer.program("vwap_line", LINE_VS, FS);
    this.leashEntry = renderer.program("vwap_leash", LEASH_VS, FS);
    this.lineCount = 0;
    this.leashCount = 0;
    this.lineBuf = gl.createBuffer();
    this.leashBuf = gl.createBuffer();
    this.lineVao = gl.createVertexArray();
    this.leashVao = gl.createVertexArray();

    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    const stride = 8 * 4;
    const bind = (prog, name, size, off) => {
      const loc = gl.getAttribLocation(prog, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off);
    };
    bind(this.lineEntry.prog, "a_pos", 2, 0);
    bind(this.lineEntry.prog, "a_prev", 2, 8);
    bind(this.lineEntry.prog, "a_next", 2, 16);
    bind(this.lineEntry.prog, "a_side", 1, 24);
    // a_local unused — still in stride from buildLineStrip
    gl.bindVertexArray(null);

    gl.bindVertexArray(this.leashVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.leashBuf);
    const loc = gl.getAttribLocation(this.leashEntry.prog, "a_pt");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 2 * 4, 0);
    gl.bindVertexArray(null);
  }

  setData(bars) {
    const { gl } = this.r;
    this.vwap = buildVwap(bars);
    // Fake bar objects for buildLineStrip value accessor
    const fake = bars.map((b, i) => ({ ...b, c: this.vwap[i] }));
    const lineData = buildLineStrip(fake, (b) => b.c);
    this.lineCount = bars.length * 2;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, lineData, gl.DYNAMIC_DRAW);

    const leash = buildVwapLeash(bars, this.vwap, 56);
    this.leashCount = leash.count;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.leashBuf);
    gl.bufferData(gl.ARRAY_BUFFER, leash.data, gl.DYNAMIC_DRAW);
  }

  draw(vp, theme, syn) {
    if (!syn || this.lineCount < 4) return;
    const { gl } = this.r;
    const spine = parseColor(theme.synesthesia?.vwap || "#9ef0d0", 0.55);
    const thread = parseColor(theme.synesthesia?.leash || "#9ef0d0", 0.18 + 0.15 * syn.vol);

    // VWAP spine
    const le = this.lineEntry;
    gl.useProgram(le.prog);
    this.r.setProjection(le, vp);
    gl.uniform1f(le.loc("u_widthPx"), 1.15);
    gl.uniform4fv(le.loc("u_color"), spine);
    gl.bindVertexArray(this.lineVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, this.lineCount);

    // Leash threads
    const ke = this.leashEntry;
    gl.useProgram(ke.prog);
    this.r.setProjection(ke, vp);
    gl.uniform4fv(ke.loc("u_color"), thread);
    gl.bindVertexArray(this.leashVao);
    gl.drawArrays(gl.LINES, 0, this.leashCount);
    gl.bindVertexArray(null);
  }

  dispose() {
    const { gl } = this.r;
    gl.deleteBuffer(this.lineBuf);
    gl.deleteBuffer(this.leashBuf);
    gl.deleteVertexArray(this.lineVao);
    gl.deleteVertexArray(this.leashVao);
  }
}
