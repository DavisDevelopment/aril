// glcharts/series/gravityWell.js — underwater drawdown fill (price → rolling peak).
// Only meaningful with synesthesia on; opacity tracks per-bar drawdown depth.

import { PROJ_GLSL } from "../core/renderer.js";
import { buildGravityWellStrip } from "./synesthesia.js";
import { parseColor } from "../theme.js";

const VS = `#version 300 es
precision highp float;
${PROJ_GLSL}
in vec4 a_pt; // (idx, price, kind, dd)
out float v_kind;
out float v_dd;

void main() {
  v_kind = a_pt.z;
  v_dd = a_pt.w;
  float x = idxToPx(a_pt.x);
  float y = priceToPx(a_pt.y);
  gl_Position = vec4(pxToClip(vec2(x, y)), 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
uniform vec4 u_color;     // rgb + max alpha
uniform float u_depth;    // global intensity 0..1
in float v_kind;
in float v_dd;
out vec4 outColor;
void main() {
  // Stronger near the close (kind 0), fading toward the peak line.
  float falloff = mix(1.0, 0.15, v_kind);
  float a = u_color.a * v_dd * falloff * (0.35 + 0.65 * u_depth);
  outColor = vec4(u_color.rgb, a);
}`;

export class GravityWellSeries {
  constructor(renderer) {
    this.r = renderer;
    const { gl } = renderer;
    this.entry = renderer.program("gravity_well", VS, FS);
    this.count = 0;
    this.buf = gl.createBuffer();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const loc = gl.getAttribLocation(this.entry.prog, "a_pt");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 4 * 4, 0);
    gl.bindVertexArray(null);
  }

  setData(bars) {
    const { gl } = this.r;
    const data = buildGravityWellStrip(bars);
    this.count = bars.length * 2;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  }

  draw(vp, theme, syn) {
    if (this.count < 4 || !syn || syn.ddDepth < 0.02) return;
    const { gl } = this.r;
    const e = this.entry;
    const col = parseColor(theme.synesthesia?.gravity || "#6b4cff", 0.42);
    gl.useProgram(e.prog);
    this.r.setProjection(e, vp);
    gl.uniform4fv(e.loc("u_color"), col);
    gl.uniform1f(e.loc("u_depth"), syn.ddDepth);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, this.count);
    gl.bindVertexArray(null);
  }

  dispose() {
    const { gl } = this.r;
    gl.deleteBuffer(this.buf);
    gl.deleteVertexArray(this.vao);
  }
}
