// glcharts/series/momentum.js — the price line colored ALONG ITS LENGTH by local momentum
// (rate of change), so acceleration reads at a glance: warm/up vs cool/down through a neutral
// midpoint. A momentum-encoded line-chart mode; also a striking live visual as it streams.
//
// dataviz: polarity (up vs down) → DIVERGING. Two hues + a neutral gray midpoint; never a hue at
// the midpoint. Poles validated CVD-safe (green↔royal, deutan ΔE 32.6) — the green↔red default is
// a red/green trap and was rejected by scripts/validate_palette.js.

import { PROJ_GLSL } from "../core/renderer.js";
import { buildLineStrip } from "./geometry.js";
import { parseColor } from "../theme.js";

const WINDOW = 4;       // bars over which momentum is measured
const SCALE = 0.032;    // fractional move that saturates the ramp (±3.2%)

const VS = `#version 300 es
precision highp float;
${PROJ_GLSL}
uniform float u_widthPx;
in vec2 a_pos;
in vec2 a_prev;
in vec2 a_next;
in float a_side;
in float a_mom;         // -1..1 momentum (reused localVol slot)
out float v_edge;
out float v_mom;

vec2 proj(vec2 d) { return vec2(idxToPx(d.x), priceToPx(d.y)); }

void main() {
  vec2 p = proj(a_pos), pp = proj(a_prev), pn = proj(a_next);
  vec2 dIn = p - pp, dOut = pn - p;
  if (dot(dIn, dIn)   < 1e-12) dIn  = dOut;
  if (dot(dOut, dOut) < 1e-12) dOut = dIn;
  vec2 tangent = normalize(normalize(dIn) + normalize(dOut));
  vec2 normal = vec2(-tangent.y, tangent.x);
  float miter = 1.0 / max(dot(normal, vec2(-normalize(dIn).y, normalize(dIn).x)), 0.35);
  v_edge = a_side;
  v_mom = a_mom;
  vec2 px = p + normal * (u_widthPx * 0.5 * miter) * a_side;
  gl_Position = vec4(pxToClip(px), 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
uniform vec3 u_pos;     // up pole
uniform vec3 u_mid;     // neutral midpoint
uniform vec3 u_neg;     // down pole
in float v_edge;
in float v_mom;
out vec4 outColor;
void main() {
  float t = clamp(v_mom, -1.0, 1.0);
  vec3 c = t >= 0.0 ? mix(u_mid, u_pos, t) : mix(u_mid, u_neg, -t);
  float aa = smoothstep(1.0, 0.55, abs(v_edge));   // soft antialiased edge
  outColor = vec4(c, aa);
}`;

export class MomentumSeries {
  constructor(renderer) {
    this.r = renderer;
    const { gl } = renderer;
    this.entry = renderer.program("momentum", VS, FS);
    this.count = 0;
    this.buf = gl.createBuffer();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const stride = 8 * 4;
    const bind = (name, size, off) => {
      const loc = gl.getAttribLocation(this.entry.prog, name);
      if (loc < 0) return;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off);
    };
    bind("a_pos", 2, 0);
    bind("a_prev", 2, 8);
    bind("a_next", 2, 16);
    bind("a_side", 1, 24);
    bind("a_mom", 1, 28);      // momentum lives in the localVol slot
    gl.bindVertexArray(null);
  }

  setData(bars) {
    const { gl } = this.r;
    const n = bars.length;
    const mom = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = bars[Math.max(0, i - WINDOW)].c;
      const raw = (bars[i].c - a) / Math.max(Math.abs(a), 1e-9);
      mom[i] = Math.max(-1, Math.min(1, raw / SCALE));
    }
    this.count = n * 2;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, buildLineStrip(bars, (b) => b.c, mom), gl.DYNAMIC_DRAW);
  }

  draw(vp, theme, { width = null } = {}) {
    if (this.count < 4) return;
    const { gl } = this.r;
    const e = this.entry;
    const ramp = theme.momentum || {};
    gl.useProgram(e.prog);
    this.r.setProjection(e, vp);
    gl.uniform1f(e.loc("u_widthPx"), width ?? ramp.widthPx ?? 2.0);
    const up = parseColor(ramp.pos || "#4bc46a", 1);
    const mid = parseColor(ramp.mid || "#6c6580", 1);
    const neg = parseColor(ramp.neg || "#7c5cfc", 1);
    gl.uniform3f(e.loc("u_pos"), up[0], up[1], up[2]);
    gl.uniform3f(e.loc("u_mid"), mid[0], mid[1], mid[2]);
    gl.uniform3f(e.loc("u_neg"), neg[0], neg[1], neg[2]);
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
