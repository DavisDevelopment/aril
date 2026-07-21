// glcharts/series/confidenceFan.js — a forward "confidence cone": translucent quantile bands
// projected from the last price into the near future, widening with √t like a real diffusion of
// outcomes. This is the fair-value + calibrated-confidence thesis made literal — the same shape a
// forecast/uncertainty overlay uses in the app. Needs right-edge room (GlChart widens
// rightOffsetBars to FAN_BARS when enabled) so the cone isn't scissor-clipped at the plot edge.

import { PROJ_GLSL } from "../core/renderer.js";
import { parseColor } from "../theme.js";

export const FAN_BARS = 22;                 // future slots the cone spans
const BANDS = [                              // outer→inner: z-width × opacity
  { z: 2.1, a: 0.10 },
  { z: 1.3, a: 0.14 },
  { z: 0.6, a: 0.20 },
];

const VS = `#version 300 es
precision highp float;
${PROJ_GLSL}
uniform float u_z;
in float a_idx;
in float a_center;
in float a_sigma;
in float a_side;
in float a_t;          // 0..1 along the cone
out float v_t;
void main() {
  v_t = a_t;
  float y = a_center + a_sigma * u_z * a_side;
  gl_Position = vec4(pxToClip(vec2(idxToPx(a_idx), priceToPx(y))), 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
uniform vec3 u_color;
uniform float u_alpha;
in float v_t;
out vec4 outColor;
void main() {
  // fade the cone out as it reaches into the future
  float a = u_alpha * (1.0 - 0.55 * v_t);
  outColor = vec4(u_color, a);
}`;

export class ConfidenceFanSeries {
  constructor(renderer) {
    this.r = renderer;
    const { gl } = renderer;
    this.entry = renderer.program("confidenceFan", VS, FS);
    this.count = 0;
    this.buf = gl.createBuffer();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const stride = 5 * 4;
    const bind = (name, size, off) => {
      const loc = gl.getAttribLocation(this.entry.prog, name);
      if (loc < 0) return;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off);
    };
    bind("a_idx", 1, 0);
    bind("a_center", 1, 4);
    bind("a_sigma", 1, 8);
    bind("a_side", 1, 12);
    bind("a_t", 1, 16);
    gl.bindVertexArray(null);
  }

  setData(bars) {
    const { gl } = this.r;
    const n = bars.length;
    this.count = 0;
    if (n < 8) return;
    // per-step σ from recent log-return volatility
    let s = 0, m = 0, cnt = 0;
    for (let i = Math.max(1, n - 34); i < n; i++) {
      const r = Math.log(bars[i].c / Math.max(bars[i - 1].c, 1e-9));
      m += r; cnt++;
    }
    m /= Math.max(1, cnt);
    for (let i = Math.max(1, n - 34); i < n; i++) {
      const r = Math.log(bars[i].c / Math.max(bars[i - 1].c, 1e-9));
      s += (r - m) * (r - m);
    }
    const std = Math.sqrt(s / Math.max(1, cnt - 1)) || 0.004;
    const lastIdx = n - 1, center = bars[n - 1].c;
    const K = FAN_BARS;
    const verts = new Float32Array((K + 1) * 2 * 5);
    let k = 0;
    for (let t = 0; t <= K; t++) {
      const sigma = center * std * Math.sqrt(t);   // price-space half-width at z=1
      const tt = t / K;
      for (const side of [1, -1]) {
        verts[k++] = lastIdx + t;
        verts[k++] = center;
        verts[k++] = sigma;
        verts[k++] = side;
        verts[k++] = tt;
      }
    }
    this.count = (K + 1) * 2;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
  }

  draw(vp, theme) {
    if (this.count < 4) return;
    const { gl } = this.r;
    const e = this.entry;
    gl.useProgram(e.prog);
    this.r.setProjection(e, vp);
    const col = parseColor(theme.confidenceFan?.color || theme.line?.color || "#a78bfa", 1);
    gl.uniform3f(e.loc("u_color"), col[0], col[1], col[2]);
    const gain = theme.confidenceFan?.alpha ?? 1;
    gl.bindVertexArray(this.vao);
    for (const b of BANDS) {                       // outer (faint) → inner (brighter)
      gl.uniform1f(e.loc("u_z"), b.z);
      gl.uniform1f(e.loc("u_alpha"), b.a * gain);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, this.count);
    }
    gl.bindVertexArray(null);
  }

  dispose() {
    const { gl } = this.r;
    gl.deleteBuffer(this.buf);
    gl.deleteVertexArray(this.vao);
  }
}
