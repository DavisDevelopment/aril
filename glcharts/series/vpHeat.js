// glcharts/series/vpHeat.js — Volume-at-Price heat: a sequential (single-hue) shading of the
// plot background whose opacity tracks how much volume traded at each price level. A standard
// pro-analytics view (volume profile), rendered as one full-plot quad sampling a CPU-built
// histogram — so it costs one draw and re-maps to the live price range every frame (zoom-stable).
//
// dataviz: magnitude → SEQUENTIAL. One hue (theme accent), light→dark via alpha; never a rainbow.

import { parseColor } from "../theme.js";

const BINS = 48;

const VS = `#version 300 es
precision highp float;
in vec2 a_corner;              // (0,0)…(1,1)
out vec2 v_uv;
void main() { v_uv = a_corner; gl_Position = vec4(a_corner * 2.0 - 1.0, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform float u_vp[${BINS}];   // normalized volume per price bin (0..1)
uniform vec2  u_bin;           // (binPriceMin, binPriceMax) the histogram spans
uniform vec2  u_price;         // (priceMin, priceMax) currently on screen
uniform vec3  u_hue;           // sequential hue
uniform float u_maxA;          // peak opacity
in vec2 v_uv;
out vec4 outColor;

float sampleVp(float f) {
  if (f < 0.0 || f > 1.0) return 0.0;
  float x = f * float(${BINS} - 1);
  int i = int(floor(x));
  int j = min(i + 1, ${BINS} - 1);
  return mix(u_vp[i], u_vp[j], fract(x));
}

void main() {
  float price = mix(u_price.x, u_price.y, v_uv.y);           // frag → price
  float f = (price - u_bin.x) / max(u_bin.y - u_bin.x, 1e-9); // price → histogram pos
  float v = sampleVp(f);
  // sequential: opacity carries magnitude; a faint horizontal ridge marks the level
  float a = pow(v, 0.62) * u_maxA;
  outColor = vec4(u_hue, a);
}`;

export class VpHeatSeries {
  constructor(renderer) {
    this.r = renderer;
    const { gl } = renderer;
    this.entry = renderer.program("vpHeat", VS, FS);
    this.vp = new Float32Array(BINS);
    this.binMin = 0;
    this.binMax = 1;
    this.ready = false;

    this.buf = gl.createBuffer();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.entry.prog, "a_corner");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  setData(bars) {
    const n = bars.length;
    this.ready = n > 1;
    if (!this.ready) return;
    let lo = Infinity, hi = -Infinity;
    for (const b of bars) { if (b.l < lo) lo = b.l; if (b.h > hi) hi = b.h; }
    if (!(hi > lo)) { this.ready = false; return; }
    this.binMin = lo; this.binMax = hi;
    const bins = this.vp; bins.fill(0);
    const span = hi - lo;
    for (const b of bars) {
      // spread each bar's volume across the bins its [low,high] range covers
      const v = b.v || 0;
      const a = Math.max(0, Math.floor(((b.l - lo) / span) * (BINS - 1)));
      const c = Math.min(BINS - 1, Math.ceil(((b.h - lo) / span) * (BINS - 1)));
      const share = v / Math.max(1, c - a + 1);
      for (let k = a; k <= c; k++) bins[k] += share;
    }
    let max = 0; for (let k = 0; k < BINS; k++) if (bins[k] > max) max = bins[k];
    if (max > 0) for (let k = 0; k < BINS; k++) bins[k] /= max;
  }

  draw(vp, theme) {
    if (!this.ready) return;
    const { gl } = this.r;
    const e = this.entry;
    gl.useProgram(e.prog);
    gl.uniform1fv(e.loc("u_vp"), this.vp);
    gl.uniform2f(e.loc("u_bin"), this.binMin, this.binMax);
    gl.uniform2f(e.loc("u_price"), vp.priceMin, vp.priceMax);
    const hue = parseColor(theme.vpHeat?.hue || theme.line?.color || "#c78bf5", 1);
    gl.uniform3f(e.loc("u_hue"), hue[0], hue[1], hue[2]);
    gl.uniform1f(e.loc("u_maxA"), theme.vpHeat?.maxAlpha ?? 0.22);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  dispose() {
    const { gl } = this.r;
    gl.deleteBuffer(this.buf);
    gl.deleteVertexArray(this.vao);
  }
}
