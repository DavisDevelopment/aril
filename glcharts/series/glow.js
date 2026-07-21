// glcharts/series/glow.js — an additive "bloom" pass under the price: the close-price polyline
// redrawn as a wide, soft, edge-fading stroke in ADDITIVE blend. Reads as a neon halo around the
// series. Generally useful to emphasize the active series / a fired signal; cheap (one extra pass,
// reuses the standard expanded-polyline geometry). Draw BEFORE the crisp series so it sits behind.

import { PROJ_GLSL } from "../core/renderer.js";
import { buildLineStrip } from "./geometry.js";
import { parseColor } from "../theme.js";

const VS = `#version 300 es
precision highp float;
${PROJ_GLSL}
uniform float u_widthPx;
in vec2 a_pos;
in vec2 a_prev;
in vec2 a_next;
in float a_side;
out float v_edge;

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
  vec2 px = p + normal * (u_widthPx * 0.5 * miter) * a_side;
  gl_Position = vec4(pxToClip(px), 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
uniform vec3 u_color;
uniform float u_alpha;
in float v_edge;
out vec4 outColor;
void main() {
  // gaussian-ish falloff across the stroke width → soft halo
  float a = exp(-3.2 * v_edge * v_edge) * u_alpha;
  outColor = vec4(u_color, a);
}`;

export class GlowSeries {
  constructor(renderer) {
    this.r = renderer;
    const { gl } = renderer;
    this.entry = renderer.program("glow", VS, FS);
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
    gl.bindVertexArray(null);
  }

  setData(bars) {
    const { gl } = this.r;
    this.count = bars.length * 2;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, buildLineStrip(bars), gl.DYNAMIC_DRAW);
  }

  draw(vp, theme, { width = null, alpha = null } = {}) {
    if (this.count < 4) return;
    const { gl } = this.r;
    const e = this.entry;
    gl.useProgram(e.prog);
    this.r.setProjection(e, vp);
    gl.uniform1f(e.loc("u_widthPx"), width ?? theme.glow?.widthPx ?? 9);
    const col = parseColor(theme.glow?.color || theme.line?.color || "#c78bf5", 1);
    gl.uniform3f(e.loc("u_color"), col[0], col[1], col[2]);
    gl.uniform1f(e.loc("u_alpha"), alpha ?? theme.glow?.alpha ?? 0.5);
    // additive so overlapping halo accumulates into a glow, then restore standard blend
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, this.count);
    gl.bindVertexArray(null);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  dispose() {
    const { gl } = this.r;
    gl.deleteBuffer(this.buf);
    gl.deleteVertexArray(this.vao);
  }
}
