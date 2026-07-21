// glcharts/series/line.js — constant-width polyline + full synesthesia pack.

import { PROJ_GLSL } from "../core/renderer.js";
import { buildLineStrip } from "./geometry.js";
import { parseColor } from "../theme.js";
import { temperatureColor, buildLocalVol } from "./synesthesia.js";

const VS = `#version 300 es
precision highp float;
${PROJ_GLSL}
uniform float u_widthPx;
uniform float u_time;
uniform float u_vol;
uniform float u_ampPx;
uniform float u_splitPx;
uniform float u_pass;
uniform float u_period;
uniform float u_haze;
uniform float u_hazePx;
uniform float u_soft;
uniform float u_skew;       // -1..+1 lub/dub asymmetry
in vec2 a_pos;
in vec2 a_prev;
in vec2 a_next;
in float a_side;
in float a_local;           // 0..1 local vol hotspot
out float v_crown;
out float v_pass;
out float v_haze;
out float v_local;

vec2 proj(vec2 d) { return vec2(idxToPx(d.x), priceToPx(d.y)); }

float heartbeat(float phase, float skew) {
  // Neg skew (downside-heavy) → heavier second beat; pos → stronger first.
  float lubW = 1.0 + max(0.0, skew) * 0.55;
  float dubW = 0.55 + max(0.0, -skew) * 0.70;
  float lub = pow(max(0.0, sin(phase)), 14.0) * lubW;
  float dub = pow(max(0.0, sin(phase - 0.62)), 18.0) * dubW;
  return lub + dub;
}

void main() {
  vec2 p  = proj(a_pos);
  vec2 pp = proj(a_prev);
  vec2 pn = proj(a_next);
  vec2 dirIn  = p - pp;
  vec2 dirOut = pn - p;
  if (dot(dirIn, dirIn)   < 1e-12) dirIn  = dirOut;
  if (dot(dirOut, dirOut) < 1e-12) dirOut = dirIn;
  vec2 tangent = normalize(normalize(dirIn) + normalize(dirOut));
  vec2 normal  = vec2(-tangent.y, tangent.x);
  float miter = 1.0 / max(dot(normal, vec2(-normalize(dirIn).y, normalize(dirIn).x)), 0.35);

  float speed = 6.2831853 / max(u_period, 0.4);
  float phase = a_pos.x * 0.11 - u_time * speed * (0.85 + 0.30 * u_vol);
  float localBoost = 0.55 + 0.90 * a_local;
  float pulse = heartbeat(phase, u_skew) * localBoost;
  float crown = pow(max(pulse, 0.0) / max(localBoost, 1e-3), 2.4);
  v_crown = crown * u_vol;
  v_pass = u_pass;
  v_haze = u_haze;
  v_local = a_local;

  float displace = pulse * u_ampPx * u_vol;
  float shimmer = u_haze * u_hazePx * sin(a_pos.x * 1.7 + u_time * 9.0) * (0.35 + 0.65 * a_local);
  float split = crown * crown * u_splitPx * u_vol * (0.6 + 0.8 * a_local);
  float centerOff = displace + shimmer + u_pass * split;

  float halfW = u_widthPx * 0.5 * (1.0 + 0.35 * u_soft);
  if (abs(u_pass) > 0.5) halfW *= 0.55;

  vec2 px = p + normal * (centerOff + a_side * halfW * miter);
  gl_Position = vec4(pxToClip(px), 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
uniform vec4 u_color;
uniform float u_regime;
uniform vec3 u_regimeRgb;
uniform float u_soft;
in float v_crown;
in float v_pass;
in float v_haze;
in float v_local;
out vec4 outColor;
void main() {
  vec4 c = u_color;
  c.a *= mix(1.0, 0.78, u_soft);
  if (abs(v_pass) > 0.5) {
    c.a *= 0.18 + 0.55 * v_crown;
  } else {
    c.rgb = mix(c.rgb, vec3(1.0), 0.08 * v_crown + 0.06 * v_local * v_haze);
    c.a *= 0.92 + 0.08 * v_crown;
    c.rgb = mix(c.rgb, c.rgb * 1.08, v_haze * 0.25);
  }
  c.rgb = mix(c.rgb, u_regimeRgb, u_regime * 0.55);
  outColor = c;
}`;

export class LineSeries {
  constructor(renderer) {
    this.r = renderer;
    const { gl } = renderer;
    this.entry = renderer.program("line_syn2", VS, FS);
    this.count = 0;
    this.buf = gl.createBuffer();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const stride = 8 * 4;
    const bind = (name, size, off) => {
      const loc = gl.getAttribLocation(this.entry.prog, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off);
    };
    bind("a_pos", 2, 0);
    bind("a_prev", 2, 8);
    bind("a_next", 2, 16);
    bind("a_side", 1, 24);
    bind("a_local", 1, 28);
    gl.bindVertexArray(null);
  }

  setData(bars, value) {
    const { gl } = this.r;
    const local = buildLocalVol(bars);
    const data = buildLineStrip(bars, value, local);
    this.count = bars.length * 2;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  }

  draw(vp, theme, pulse = {}) {
    if (this.count < 4) return;
    const { gl } = this.r;
    const e = this.entry;
    const hb = theme.line.heartbeat || {};
    const synTok = theme.synesthesia || {};
    const syn = pulse.syn;
    const sensory = pulse.enabled && syn;

    const vol = (hb.enabled !== false && (sensory || pulse.heartbeatOnly))
      ? clamp01(syn?.vol ?? pulse.vol ?? 0)
      : 0;
    const time = pulse.time ?? 0;
    const mass = sensory ? clamp01(syn.mass) : 0.4;
    const haze = sensory ? clamp01(syn.haze) : 0;
    const soft = sensory ? clamp01(syn.soft) : 0;
    const regime = sensory ? clamp01(syn.regimeFlash) : 0;
    const skew = sensory ? clamp(syn.skew ?? 0, -1, 1) : 0;
    const periodScale = sensory ? (syn.periodScale || 1) : 1;

    let rgba = parseColor(theme.line.color);
    if (sensory) {
      const cool = parseColor(synTok.cool || theme.line.color);
      const warm = parseColor(synTok.warm || "#ff7a59");
      const rgb = temperatureColor(cool, warm, syn.temp);
      rgba = [rgb[0], rgb[1], rgb[2], 1];
    }
    if (pulse.alphaMul != null) rgba[3] *= pulse.alphaMul;
    const regimeRgb = parseColor(synTok.regimeHue || "#c4a1ff");
    const width = theme.line.width
      * (sensory ? (1 + (synTok.massWidthBoost - 1) * mass) : 1)
      * (pulse.widthMul ?? 1);
    const period = (hb.period ?? 2.6) * periodScale;

    gl.useProgram(e.prog);
    this.r.setProjection(e, vp);
    gl.uniform1f(e.loc("u_widthPx"), width);
    gl.uniform4fv(e.loc("u_color"), rgba);
    gl.uniform1f(e.loc("u_time"), time);
    gl.uniform1f(e.loc("u_vol"), vol);
    gl.uniform1f(e.loc("u_ampPx"), hb.ampPx ?? 2.4);
    gl.uniform1f(e.loc("u_splitPx"), hb.splitPx ?? 1.6);
    gl.uniform1f(e.loc("u_period"), period);
    gl.uniform1f(e.loc("u_haze"), haze);
    gl.uniform1f(e.loc("u_hazePx"), synTok.hazeDisplacePx ?? 1.1);
    gl.uniform1f(e.loc("u_soft"), soft);
    gl.uniform1f(e.loc("u_skew"), skew);
    gl.uniform1f(e.loc("u_regime"), regime);
    gl.uniform3f(e.loc("u_regimeRgb"), regimeRgb[0], regimeRgb[1], regimeRgb[2]);
    gl.bindVertexArray(this.vao);

    if (vol > 0.08 && !pulse.echo) {
      gl.uniform1f(e.loc("u_pass"), 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, this.count);
      gl.uniform1f(e.loc("u_pass"), -1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, this.count);
    }
    gl.uniform1f(e.loc("u_pass"), 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, this.count);
    gl.bindVertexArray(null);
  }

  dispose() {
    const { gl } = this.r;
    gl.deleteBuffer(this.buf);
    gl.deleteVertexArray(this.vao);
  }
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
