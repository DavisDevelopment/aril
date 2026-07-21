/* hero-gl.js — the hero's full-bleed background: a rotating wall of REAL glcharts
 * WebGL2 charts (vendored at docs/glcharts/). Each slide gets a randomized —
 * strictly professional — display config (chart type, overlay indicators, volume,
 * symbol/timeframe), a mostly-up random walk, animates in, stream-ticks a handful
 * of fresh bars, sometimes reconfigures itself mid-render to show it's live and
 * configurable, then the next slide slides in. Two GL instances ping-pong so we
 * never spin up more than two GL contexts. On-chart axis/legend/last-price TEXT is
 * suppressed (kept as a clean visual backdrop). Falls back to the canvas-2D hero
 * chart if WebGL2 is unavailable; idles when scrolled offscreen.
 */
import { GlChart } from "../glcharts/GlChart.js";

const bg = document.getElementById("hero-bg");

// professional-only rotation — no synesthesia / sensory "woo", no exotic types
const TYPES = ["candles", "ohlc", "line", "area", "heikinAshi", "hollow", "volumeCandles", "highLow"];
const OVERLAYS = ["MA", "EMA", "BOLL", "VWAP"];            // line overlays only (no text-heavy panes)
const SYMBOLS = [
  "BTC / USD", "ETH / USD", "SOL / USD", "EUR / USD", "GBP / USD",
  "XAU / USD", "AAPL", "NVDA", "SPY", "MDRS / USD", "TSLA", "USD / JPY",
];
const RES = ["1m", "5m", "15m", "1h", "4h", "1d"];
const RES_SECS = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 };

// ── rng ───────────────────────────────────────────────────────────────────────
let _seed = (Date.now() ^ 0x9e3779b9) >>> 0;
function rnd() { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 2 ** 32; }
function pick(a) { return a[Math.floor(rnd() * a.length)]; }
function sample(a, n) {
  const c = a.slice();
  for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; }
  return c.slice(0, n);
}

function webgl2Supported() {
  try { return !!document.createElement("canvas").getContext("webgl2"); }
  catch (_) { return false; }
}

// ── a mostly-upward feed (kept as continuable state so ticks extend it) ─────────
function makeFeed(res) {
  const dt = RES_SECS[res] || 3600;
  const n = 170 + Math.floor(rnd() * 70);
  const base = 12 + rnd() * 480;
  const drift = 0.0009 + rnd() * 0.0016;                  // positive → trends up
  const vol = 0.004 + rnd() * 0.009;
  const down = rnd() < 0.08;                              // ~8% of slides drift down instead
  const state = { dt, base, drift: down ? -drift * 0.6 : drift, vol, x: 0, t: 0 };
  const bars = [];
  const t0 = Math.floor(Date.now() / 1000) - n * dt;
  let open = base;
  for (let i = 0; i < n; i++) bars.push(nextBar(state, t0 + i * dt, i === 0 ? base : open, (b) => (open = b.c)));
  return { bars, state };
}
function nextBar(s, t, open, after) {
  let p = s.base * Math.exp(s.x), h = p, l = p;
  for (let k = 0; k < 3; k++) {
    s.x += s.drift + (rnd() - 0.5) * 2 * s.vol;
    p = s.base * Math.exp(s.x); h = Math.max(h, p); l = Math.min(l, p);
  }
  const o = open != null ? open : p, c = p;
  const bar = { t, o, h: Math.max(o, c, h), l: Math.min(o, c, l), c, v: Math.round(1e5 * (0.3 + rnd())) };
  if (after) after(bar);
  return bar;
}

// ── a randomized, professional display config ───────────────────────────────────
function randomCfg() {
  const type = pick(TYPES);
  const nOverlays = rnd() < 0.28 ? 0 : (rnd() < 0.7 ? 1 : 2);
  const overlays = sample(OVERLAYS, nOverlays).map((id) => ({
    id, params: id === "BOLL" ? { n: pick([20, 30]), k: 2 } : (id === "VWAP" ? {} : { n: pick([9, 20, 50, 100]) }),
  }));
  const isLine = type === "line" || type === "area";
  return {
    type,
    symbol: pick(SYMBOLS),
    res: pick(RES),
    showVolume: isLine ? false : rnd() < 0.7,
    overlays,
    // extra shader layers — kept tasteful; momentum-hue only makes sense on a line/area
    vpHeat: rnd() < 0.34,
    glow: rnd() < 0.42,
    momentumColor: isLine && rnd() < 0.55,
    confidenceFan: rnd() < 0.3,
  };
}

// strip axis/legend/last-price TEXT so a background chart stays a clean visual
function muteText(chart) {
  const ov = chart && chart.overlay;
  if (!ov) return;
  const noop = () => {};
  ov._priceAxis = noop;
  ov._timeAxis = noop;
  ov._legend = noop;
  ov._lastPrice = noop;
}

function applyCfg(chart, cfg) {
  chart.getIndicators().forEach((i) => chart.removeIndicator(i.uid));
  chart.setType(cfg.type);
  chart.setSymbol(cfg.symbol, cfg.res);
  chart.setShowVolume(cfg.showVolume);
  const feed = makeFeed(cfg.res);
  chart.setData(feed.bars);
  chart.fitContent();
  cfg.overlays.forEach((o) => { try { chart.addIndicator(o.id, o.params); } catch (_) {} });
  // extra shader layers (setConfidenceFan last — it re-fits the right edge for the cone)
  try {
    chart.setVpHeat(cfg.vpHeat);
    chart.setGlow(cfg.glow);
    chart.setMomentumColor(cfg.momentumColor);
    chart.setConfidenceFan(cfg.confidenceFan);
  } catch (_) {}
  return feed;
}

function bootWall() {
  // two ping-pong slides. NOTE: GlChart writes an inline `position:relative` onto
  // its container, which would override .hero-slide's absolute inset:0 and collapse
  // it to 0 height — so the chart mounts into an inner .hero-mount, not the slide.
  const slots = [0, 1].map(() => {
    const el = document.createElement("div");
    el.className = "hero-slide";
    const mount = document.createElement("div");
    mount.className = "hero-mount";
    el.appendChild(mount);
    bg.appendChild(el);
    return { el, mount, chart: null, feed: null, cfg: null, tickId: 0, barId: 0, midId: 0 };
  });

  // probe with the first chart; if no GL, tear down and fall back
  slots[0].chart = new GlChart(slots[0].mount, { theme: "dark", type: "candles", synesthesia: false });
  if (!slots[0].chart.webgl) { slots.forEach((s) => s.chart && s.chart.dispose && s.chart.dispose()); bg.innerHTML = ""; return false; }
  muteText(slots[0].chart);
  slots[1].chart = new GlChart(slots[1].mount, { theme: "dark", type: "candles", synesthesia: false });
  muteText(slots[1].chart);

  const HOLD = 5200;         // ms a slide stays before the next arrives
  let active = -1, running = false, timer = 0;

  function clearStream(s) { clearInterval(s.tickId); clearInterval(s.barId); clearTimeout(s.midId); s.tickId = s.barId = s.midId = 0; }

  function stream(s) {
    let last = s.feed.bars[s.feed.bars.length - 1];
    // intra-bar liveliness
    s.tickId = setInterval(() => {
      if (!running) return;
      const c = last.c * (1 + (rnd() - 0.5) * 0.0016);
      last = { ...last, c, h: Math.max(last.h, c), l: Math.min(last.l, c), v: last.v + 30 };
      s.feed.bars[s.feed.bars.length - 1] = last;
      s.chart.updateLast(last);
    }, 130);
    // a handful of fresh bars roll in
    s.barId = setInterval(() => {
      if (!running) return;
      const b = nextBar(s.feed.state, last.t + s.feed.state.dt, last.c);
      s.feed.bars.push(b); last = b;
      s.chart.append(b);
    }, 780);
    // ~45% of slides visibly reconfigure mid-render (proof it's configurable)
    if (rnd() < 0.45) {
      s.midId = setTimeout(() => {
        if (!running) return;
        const roll = rnd();
        if (roll < 0.4) {                                   // toggle an overlay
          const cur = s.chart.getIndicators();
          if (cur.length) s.chart.removeIndicator(pick(cur).uid);
          else { const o = pick(OVERLAYS); try { s.chart.addIndicator(o, o === "VWAP" ? {} : { n: 20 }); } catch (_) {} }
        } else if (roll < 0.72) {                           // switch chart type
          s.chart.setType(pick(TYPES));
        } else {                                            // toggle volume
          s.chart.setShowVolume(!s.chart.showVolume);
        }
      }, 1900 + rnd() * 900);
    }
  }

  function cycle() {
    const next = active < 0 ? 0 : 1 - active;
    const s = slots[next];
    s.feed = applyCfg(s.chart, s.cfg = randomCfg());

    // arm the incoming slide at its start position without animating the reset
    s.el.classList.remove("active", "leaving");
    s.el.style.transition = "none";
    void s.el.offsetWidth;                                  // reflow
    s.el.style.transition = "";

    requestAnimationFrame(() => {
      s.el.classList.add("active");
      if (active >= 0) {
        const prev = slots[active];
        prev.el.classList.remove("active");
        prev.el.classList.add("leaving");
        clearStream(prev);
      }
      active = next;
      stream(s);
    });

    timer = setTimeout(cycle, HOLD);
  }

  function start() { if (running) return; running = true; if (active < 0) cycle(); else timer = setTimeout(cycle, HOLD); }
  function stop() { running = false; clearTimeout(timer); slots.forEach(clearStream); }

  if ("IntersectionObserver" in window) {
    new IntersectionObserver((es) => {
      es.forEach((e) => { e.isIntersecting ? start() : stop(); });
    }, { threshold: 0.02 }).observe(document.getElementById("top"));
  } else { start(); }

  window.__heroWall = slots;
  return true;
}

async function fallback() {
  const el = document.createElement("div");
  el.className = "hero-slide active";
  el.style.opacity = "0.55";
  bg.appendChild(el);
  const { runFallbackChart } = await import("./hero-chart.js");
  runFallbackChart(el, null, null);
}

if (bg) {
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let ok = false;
  if (webgl2Supported()) {
    try { ok = bootWall(); } catch (err) { console.warn("[hero] chart wall failed:", err); ok = false; }
  }
  if (!ok) fallback();
  // reduced-motion: bootWall still runs but slides don't animate (CSS) and the
  // IntersectionObserver only starts one cycle; that's acceptable and calm.
  void reduce;
}
