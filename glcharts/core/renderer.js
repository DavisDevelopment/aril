// glcharts/core/renderer.js — WebGL2 context, program cache, DPR-aware sizing, frame plumbing.
// This is the only file that talks to the raw GL context lifecycle; series own their buffers but
// get programs and the per-frame projection uniforms from here.
//
// Projection contract (shared by every series shader): data space is (bar index, price); the
// vertex shaders project via the same uniforms the pure viewport math uses, so pan/zoom never
// re-uploads geometry — it only updates uniforms.

export const PROJ_GLSL = `
uniform vec2  u_size;      // plot area CSS px
uniform float u_barSpace;  // CSS px per bar slot
uniform float u_right;     // fractional bar index at the right edge
uniform vec2  u_price;     // (priceMin, priceMax)

float idxToPx(float i)   { return u_size.x - (u_right - i) * u_barSpace; }
float priceToPx(float p) { return u_size.y * (1.0 - (p - u_price.x) / max(u_price.y - u_price.x, 1e-9)); }
vec2 pxToClip(vec2 px)   { return vec2(px.x / u_size.x * 2.0 - 1.0, 1.0 - px.y / u_size.y * 2.0); }
`;

export function createRenderer(canvas) {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
  });
  if (!gl) return null; // caller decides the fallback story

  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const programs = new Map();

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error(`glcharts shader compile failed: ${log}\n---\n${src}`);
    }
    return sh;
  }

  /** Compile+link (cached by name). Returns { prog, loc(name) } with a uniform-location cache. */
  function program(name, vsSrc, fsSrc) {
    let entry = programs.get(name);
    if (entry) return entry;
    const vs = compile(gl.VERTEX_SHADER, vsSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`glcharts program link failed: ${gl.getProgramInfoLog(prog)}`);
    }
    const locs = new Map();
    entry = {
      prog,
      loc(uname) {
        if (!locs.has(uname)) locs.set(uname, gl.getUniformLocation(prog, uname));
        return locs.get(uname);
      },
    };
    programs.set(name, entry);
    return entry;
  }

  const state = { cssWidth: 0, cssHeight: 0, dpr: 1, plot: { x: 0, y: 0, w: 0, h: 0 } };

  /** Size the drawing buffer to CSS px × DPR and remember the plot sub-rect (CSS px). */
  function resize(cssWidth, cssHeight, plotRect, dpr = window.devicePixelRatio || 1) {
    state.cssWidth = cssWidth;
    state.cssHeight = cssHeight;
    state.dpr = dpr;
    state.plot = plotRect;
    const w = Math.max(1, Math.round(cssWidth * dpr));
    const h = Math.max(1, Math.round(cssHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  /** Clear the whole canvas and clip subsequent draws to the plot area. */
  function beginFrame() {
    const { dpr, plot } = state;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    // GL origin is bottom-left; plot rect is top-left CSS coords.
    const px = Math.round(plot.x * dpr);
    const py = Math.round((state.cssHeight - plot.y - plot.h) * dpr);
    const pw = Math.round(plot.w * dpr);
    const ph = Math.round(plot.h * dpr);
    gl.viewport(px, py, Math.max(1, pw), Math.max(1, ph));
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(px, py, Math.max(1, pw), Math.max(1, ph));
  }

  /** Set the shared projection uniforms for a series program. */
  function setProjection(entry, vp) {
    gl.uniform2f(entry.loc("u_size"), vp.width, vp.height);
    gl.uniform1f(entry.loc("u_barSpace"), vp.barSpace);
    gl.uniform1f(entry.loc("u_right"), vp.right);
    gl.uniform2f(entry.loc("u_price"), vp.priceMin, vp.priceMax);
  }

  function dispose() {
    for (const { prog } of programs.values()) gl.deleteProgram(prog);
    programs.clear();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  return { gl, program, resize, beginFrame, setProjection, dispose, state };
}
