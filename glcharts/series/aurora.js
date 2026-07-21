// glcharts/series/aurora.js — soft high/low envelope band (lungs of the range).

import { PROJ_GLSL } from "../core/renderer.js";
import { buildAuroraStrip } from "./sensoryExtras.js";
import { parseColor } from "../theme.js";

const VS = `#version 300 es
precision highp float;
${PROJ_GLSL}
uniform float u_time;
uniform float u_vol;
in vec3 a_pt; // idx, price, kind (0=hi 1=lo)
out float v_kind;
out float v_breath;

void main() {
  v_kind = a_pt.z;
  float breath = 0.5 + 0.5 * sin(u_time * 1.7 + a_pt.x * 0.05);
  v_breath = breath * u_vol;
  float x = idxToPx(a_pt.x);
  float y = priceToPx(a_pt.y);
  // Slight inhale/exhale of the envelope edges
  float nudge = (a_pt.z < 0.5 ? -1.0 : 1.0) * v_breath * 1.8;
  gl_Position = vec4(pxToClip(vec2(x, y + nudge)), 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
uniform vec4 u_color;
in float v_kind;
in float v_breath;
out vec4 outColor;
void main() {
  float a = u_color.a * (0.55 + 0.45 * v_breath) * (0.75 + 0.25 * (1.0 - abs(v_kind - 0.5) * 2.0));
  outColor = vec4(u_color.rgb, a);
}`;

export class AuroraSeries {
  constructor(renderer) {
    this.r = renderer;
    const { gl } = renderer;
    this.entry = renderer.program("aurora", VS, FS);
    this.count = 0;
    this.buf = gl.createBuffer();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const loc = gl.getAttribLocation(this.entry.prog, "a_pt");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 3 * 4, 0);
    gl.bindVertexArray(null);
  }

  setData(bars) {
    const { gl } = this.r;
    const data = buildAuroraStrip(bars);
    this.count = bars.length * 2;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  }

  draw(vp, theme, syn, time = 0) {
    if (this.count < 4 || !syn) return;
    const { gl } = this.r;
    const e = this.entry;
    const col = parseColor(theme.synesthesia?.aurora || "#5ec8ff", 0.11 + 0.10 * syn.vol);
    gl.useProgram(e.prog);
    this.r.setProjection(e, vp);
    gl.uniform4fv(e.loc("u_color"), col);
    gl.uniform1f(e.loc("u_time"), time);
    gl.uniform1f(e.loc("u_vol"), syn.vol);
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
