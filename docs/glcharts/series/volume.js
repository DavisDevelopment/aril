// glcharts/series/volume.js — instanced volume histogram pinned to the bottom band of the plot.
// Its y scale is independent of price: 0..vMax maps into the bottom `volumeHeightFrac` of the
// plot area (TradingView-style under-chart volume, no separate pane in v0).

import { PROJ_GLSL } from "../core/renderer.js";
import { buildVolumeInstances } from "./geometry.js";
import { parseColor } from "../theme.js";

const VS = `#version 300 es
precision highp float;
${PROJ_GLSL}
uniform float u_vMax;
uniform float u_bandFrac;   // fraction of plot height for the volume band
uniform float u_bodyFrac;
in float a_idx;
in float a_vol;
in float a_dir;
out float v_dir;

void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  v_dir = a_dir;
  float xc = idxToPx(a_idx);
  float halfW = max(u_bodyFrac * u_barSpace * 0.5, 0.5);
  float hPx = clamp(a_vol / max(u_vMax, 1e-9), 0.0, 1.0) * u_size.y * u_bandFrac;
  float yTop = u_size.y - hPx;
  vec2 px = vec2(xc - halfW + corner.x * halfW * 2.0, mix(yTop, u_size.y, corner.y));
  gl_Position = vec4(pxToClip(px), 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
uniform vec4 u_up;
uniform vec4 u_down;
in float v_dir;
out vec4 outColor;
void main() { outColor = v_dir > 0.0 ? u_up : u_down; }`;

export class VolumeSeries {
  constructor(renderer) {
    this.r = renderer;
    const { gl } = renderer;
    this.entry = renderer.program("volume", VS, FS);
    this.count = 0;
    this.vMax = 1;
    this.buf = gl.createBuffer();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const stride = 3 * 4;
    const bind = (name, size, off) => {
      const loc = gl.getAttribLocation(this.entry.prog, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off);
      gl.vertexAttribDivisor(loc, 1);
    };
    bind("a_idx", 1, 0);
    bind("a_vol", 1, 4);
    bind("a_dir", 1, 8);
    gl.bindVertexArray(null);
  }

  setData(bars) {
    const { gl } = this.r;
    const { data, vMax } = buildVolumeInstances(bars);
    this.count = bars.length;
    this.vMax = vMax;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  }

  draw(vp, theme) {
    if (!this.count || theme.volumeHeightFrac <= 0) return;
    const { gl } = this.r;
    const e = this.entry;
    gl.useProgram(e.prog);
    this.r.setProjection(e, vp);
    gl.uniform1f(e.loc("u_vMax"), this.vMax);
    gl.uniform1f(e.loc("u_bandFrac"), theme.volumeHeightFrac);
    gl.uniform1f(e.loc("u_bodyFrac"), theme.bodyFrac);
    gl.uniform4fv(e.loc("u_up"), parseColor(theme.up, theme.volumeAlpha));
    gl.uniform4fv(e.loc("u_down"), parseColor(theme.down, theme.volumeAlpha));
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
    gl.bindVertexArray(null);
  }

  dispose() {
    const { gl } = this.r;
    gl.deleteBuffer(this.buf);
    gl.deleteVertexArray(this.vao);
  }
}
