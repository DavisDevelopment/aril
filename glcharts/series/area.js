// glcharts/series/area.js — gradient fill under close; with synesthesia it breathes
// (alpha pulse + temperature tint + soft haze lift).

import { PROJ_GLSL } from "../core/renderer.js";
import { buildAreaStrip } from "./geometry.js";
import { parseColor } from "../theme.js";
import { temperatureColor } from "./synesthesia.js";

const VS = `#version 300 es
precision highp float;
${PROJ_GLSL}
uniform float u_time;
uniform float u_vol;
uniform float u_period;
uniform float u_breathPx;  // vertical lift of the top edge at pulse crest
in vec3 a_pt;   // (idx, value, kind)
out float v_kind;
out float v_pulse;

float heartbeat(float phase) {
  float lub = pow(max(0.0, sin(phase)), 14.0);
  float dub = pow(max(0.0, sin(phase - 0.62)), 18.0) * 0.55;
  return lub + dub;
}

void main() {
  v_kind = a_pt.z;
  float speed = 6.2831853 / max(u_period, 0.4);
  float phase = a_pt.x * 0.11 - u_time * speed * (0.85 + 0.30 * u_vol);
  float pulse = heartbeat(phase) * u_vol;
  v_pulse = pulse;

  float x = idxToPx(a_pt.x);
  float y = a_pt.z < 0.5
    ? priceToPx(a_pt.y) - pulse * u_breathPx
    : u_size.y;
  gl_Position = vec4(pxToClip(vec2(x, y)), 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
uniform vec4 u_color;
uniform float u_alphaBottom;
uniform float u_haze;
in float v_kind;
in float v_pulse;
out vec4 outColor;
void main() {
  float topA = u_color.a * (0.88 + 0.22 * v_pulse) * (1.0 + 0.12 * u_haze);
  float a = mix(topA, u_alphaBottom, v_kind);
  vec3 rgb = mix(u_color.rgb, u_color.rgb * 1.1, u_haze * 0.3 * (1.0 - v_kind));
  outColor = vec4(rgb, a);
}`;

export class AreaSeries {
  constructor(renderer) {
    this.r = renderer;
    const { gl } = renderer;
    this.entry = renderer.program("area_syn", VS, FS);
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

  setData(bars, value) {
    const { gl } = this.r;
    const data = buildAreaStrip(bars, value);
    this.count = bars.length * 2;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  }

  draw(vp, theme, pulse = {}) {
    if (this.count < 4) return;
    const { gl } = this.r;
    const e = this.entry;
    const syn = pulse.enabled && pulse.syn ? pulse.syn : null;
    const hb = theme.line?.heartbeat || {};

    let rgba = parseColor(theme.area.color, theme.area.alphaTop);
    if (syn) {
      const cool = parseColor(theme.synesthesia?.cool || theme.area.color);
      const warm = parseColor(theme.synesthesia?.warm || "#ff7a59");
      const rgb = temperatureColor(cool, warm, syn.temp);
      rgba = [rgb[0], rgb[1], rgb[2], theme.area.alphaTop];
    }

    gl.useProgram(e.prog);
    this.r.setProjection(e, vp);
    gl.uniform4fv(e.loc("u_color"), rgba);
    gl.uniform1f(e.loc("u_alphaBottom"), theme.area.alphaBottom);
    gl.uniform1f(e.loc("u_time"), pulse.time ?? 0);
    gl.uniform1f(e.loc("u_vol"), syn ? syn.vol : 0);
    gl.uniform1f(e.loc("u_period"), (hb.period ?? 2.6) * (syn?.periodScale || 1));
    gl.uniform1f(e.loc("u_breathPx"), syn ? 2.0 : 0);
    gl.uniform1f(e.loc("u_haze"), syn ? syn.haze : 0);
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
