/* demo.js — the live MuseScript demo embedded in the pre-launch page.
 * No build step, no framework: this is the same `muse-runtime.js` (pure
 * Haxe -> JS, @:expose'd) the Strategy Studio ships in the app, running a
 * REAL parse -> compile -> backtest in the visitor's browser. Every result
 * on screen is computed here, live, not pre-baked.
 */
(function () {
  "use strict";

  // ── synthetic tapes ───────────────────────────────────────────────────
  // Deterministic (fixed seed) so the demo looks the same on every load,
  // but shaped per-example so each strategy's pattern actually fires —
  // an engulfing detector on a flat random walk would just sit there.

  function trendTape(n, seed) {
    var bars = [], px = 100, rng = seed >>> 0;
    for (var i = 0; i < n; i++) {
      rng = (rng * 1103515245 + 12345) & 0x7fffffff;
      var noise = ((rng % 1000) / 1000 - 0.5) * 2;
      px *= 1 + Math.sin(i / 11) * 0.006 + noise * 0.004;
      var open = px * (1 + noise * 0.001);
      var close = px;
      bars.push({
        open: open, close: close,
        high: Math.max(open, close) * 1.003,
        low: Math.min(open, close) * 0.997,
        volume: 1000 + (rng % 500)
      });
    }
    return bars;
  }

  function meanRevertTape(n, seed) {
    var bars = [], px = 100, rng = seed >>> 0, phase = 0;
    for (var i = 0; i < n; i++) {
      rng = (rng * 1103515245 + 12345) & 0x7fffffff;
      var noise = ((rng % 1000) / 1000 - 0.5) * 2;
      phase += 0.14 + noise * 0.03;
      px = 100 + Math.sin(phase) * 9 + noise * 1.4;
      var open = px * (1 - noise * 0.0015);
      bars.push({
        open: open, close: px,
        high: Math.max(open, px) * 1.004,
        low: Math.min(open, px) * 0.996,
        volume: 900 + (rng % 400)
      });
    }
    return bars;
  }

  function shockTape(n, seed) {
    var bars = [], rng = seed >>> 0, prevClose = 100;
    for (var i = 0; i < n; i++) {
      rng = (rng * 1103515245 + 12345) & 0x7fffffff;
      var noise = ((rng % 1000) / 1000 - 0.5) * 2;
      var open = prevClose * (1 + noise * 0.0015);
      var drift = Math.sin(i / 11) * 0.006 + noise * 0.005;
      if (i % 17 === 8) drift = (i % 34 === 8 ? 1 : -1) * 0.035;
      var close = open * (1 + drift);
      bars.push({
        open: open, close: close,
        high: Math.max(open, close) * 1.003,
        low: Math.min(open, close) * 0.997,
        volume: 1000
      });
      prevClose = close;
    }
    return bars;
  }

  // ── examples ─────────────────────────────────────────────────────────

  var cloudJson = JSON.stringify({
    symbols: ["DEMO"],
    quantiles: [0.05, 0.25, 0.5, 0.75, 0.95],
    paths: [[[-0.06], [-0.015], [0.01], [0.035], [0.09]]],
    horizon: 5,
    coverage: { cov90: 0.88, cov50: 0.49 }
  });
  var cloudLiteral = JSON.stringify(cloudJson);

  var EXAMPLES = [
    {
      id: "trend",
      label: "Trend Cross — moving averages",
      tags: ["indicators", "crossover", "compiles to JS + WASM + numba"],
      blurb: "The classic entry point: two moving averages, a crossover, a position. Runs identically whether it's interpreted for the debugger or compiled to native code for speed.",
      tape: trendTape,
      source: [
        "strategy TrendCross {",
        "  onBar {",
        "    fastMa = sma(close, 8)",
        "    slowMa = sma(close, 26)",
        "    plot(fastMa, \"fast\")",
        "    plot(slowMa, \"slow\")",
        "    when crossover(fastMa, slowMa): { long() }",
        "    when crossunder(fastMa, slowMa): { flat() }",
        "  }",
        "}"
      ].join("\n")
    },
    {
      id: "rsi",
      label: "RSI Reversion",
      tags: ["indicators", "mean-reversion"],
      blurb: "A single built-in indicator driving a mean-reversion rule — the whole strategy is five lines.",
      tape: meanRevertTape,
      source: [
        "strategy RsiReversion {",
        "  onBar {",
        "    r = rsi(close, 14)",
        "    plot(r, \"rsi\")",
        "    when r < 30.0: { long() }",
        "    when r > 70.0: { flat() }",
        "  }",
        "}"
      ].join("\n")
    },
    {
      id: "engulfing",
      label: "Engulfing Pattern — enums",
      tags: ["enum", "pattern match", "language feature"],
      blurb: "A candlestick pattern read as a proper enum — Bullish / Bearish / Neutral — matched, not string-compared. This is what a forkable indicator's internals actually look like.",
      tape: shockTape,
      source: [
        "enum Signal {",
        "  Bullish;",
        "  Bearish;",
        "  Neutral;",
        "}",
        "",
        "function engulfing(prevOpen, prevClose, o, c) {",
        "  when c > o && prevClose < prevOpen && c > prevOpen && o < prevClose: {",
        "    return Bullish",
        "  }",
        "  when c < o && prevClose > prevOpen && c < prevOpen && o > prevClose: {",
        "    return Bearish",
        "  }",
        "  return Neutral",
        "}",
        "",
        "strategy Engulfing {",
        "  onBar {",
        "    sig = engulfing(open[1], close[1], open, close)",
        "    sigVal = match(sig) [ Bullish => 1.0, Bearish => -1.0, Neutral => 0.0 ]",
        "    plot(sigVal, \"signal\")",
        "    when sigVal > 0.0: { long() }",
        "    when sigVal < 0.0: { flat() }",
        "  }",
        "}"
      ].join("\n")
    },
    {
      id: "class",
      label: "Streaming Averager — classes",
      tags: ["class", "stateful", "language feature"],
      blurb: "State that persists bar-to-bar as a proper object with fields and a method — not a hand-rolled global accumulator. Compiles all the way to a native WASM struct with a fixed heap offset, no allocator needed.",
      tape: trendTape,
      source: [
        "class Averager {",
        "  sum = 0.0;",
        "  count = 0.0;",
        "  function add(x) {",
        "    sum = sum + x",
        "    count = count + 1.0",
        "    return sum / count",
        "  }",
        "}",
        "",
        "strategy StreamingAverager {",
        "  avg = new Averager();",
        "  onBar {",
        "    a = avg.add(close)",
        "    plot(a, \"runningAvg\")",
        "    when close > a * 1.01: { long() }",
        "    when close < a * 0.99: { flat() }",
        "  }",
        "}"
      ].join("\n")
    },
    {
      id: "probcloud",
      label: "Probability Cloud — Kestrel",
      tags: ["Kestrel bridge", "calibrated confidence", "flagship"],
      blurb: "Fair value with a shape, not a point: a fitted probability cloud from Kestrel's forecasting engine, queried right inside the strategy — position sizing driven by calibrated confidence instead of a single number.",
      tape: trendTape,
      // `source` is what actually runs; `displaySource` swaps the giant
      // escaped-JSON literal for a short placeholder so the code pane reads
      // like a strategy, not a wall of quantile data. In the real app this
      // JSON comes from `tools/kestrel_bridge.py` fitting the encoder on a
      // real tape, not a hand-typed literal — the placeholder says as much.
      displaySourceMarker: "/* fitted cloud JSON, from tools/kestrel_bridge.py — omitted here for readability */",
      source: [
        "strategy ProbCloudRebalance {",
        "  cloud = probcloud_from_json(" + cloudLiteral + ")",
        "  onBar {",
        "    pUp = probcloud_prob_above(cloud, \"DEMO\", 0.0)",
        "    conv = probcloud_conviction(cloud, \"DEMO\")",
        "    plot(pUp, \"prob_up\")",
        "    plot(conv, \"conviction\")",
        "    when pUp > 0.6: { long() }",
        "    when pUp < 0.4: { flat() }",
        "  }",
        "}"
      ].join("\n")
    }
  ];

  var N_BARS = 200;
  var SEED = 42;

  // ── tiny syntax highlighter (regex-token, not a real lexer) ───────────

  var KEYWORDS = ["strategy", "class", "enum", "function", "onBar", "when", "match", "return", "new", "var"];
  var BUILTINS = ["sma", "rsi", "crossover", "crossunder", "long", "short", "flat", "plot", "close", "open",
    "probcloud_from_json", "probcloud_prob_above", "probcloud_conviction"];

  // Single-pass tokenizer: one alternation regex walks `src` left to right,
  // classifying and HTML-escaping each match once. This intentionally never
  // re-scans its own output (unlike a chain of sequential `.replace()` calls,
  // where a later pass — e.g. matching digits — can match *inside* an HTML
  // attribute a prior pass already emitted, like `class="tok-str"`, and leak
  // raw markup into the visible code: a real bug caught by actually looking
  // at the rendered page, not just running the source through it).
  var KEYWORD_SET = {};
  KEYWORDS.forEach(function (k) { KEYWORD_SET[k] = true; });
  var BUILTIN_SET = {};
  BUILTINS.forEach(function (b) { BUILTIN_SET[b] = true; });

  var TOKEN_RE = /"([^"\\]|\\.)*"|\b\d+\.?\d*\b|\b[A-Za-z_][A-Za-z0-9_]*\b/g;

  function escHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function highlight(src) {
    var out = "", last = 0, m;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(src))) {
      out += escHtml(src.slice(last, m.index));
      var tok = m[0];
      var cls = null;
      if (tok.charAt(0) === '"') cls = "tok-str";
      else if (/^\d/.test(tok)) cls = "tok-num";
      else if (KEYWORD_SET[tok]) cls = "tok-kw";
      else if (BUILTIN_SET[tok]) cls = "tok-fn";
      out += cls ? '<span class="' + cls + '">' + escHtml(tok) + "</span>" : escHtml(tok);
      last = m.index + tok.length;
    }
    out += escHtml(src.slice(last));
    return out;
  }

  // ── engine loading (lazy) ───────────────────────────────────────────

  var enginePromise = null;
  function loadEngine() {
    if (enginePromise) return enginePromise;
    enginePromise = new Promise(function (resolve, reject) {
      if (window.MuseRuntime) { resolve(window.MuseRuntime); return; }
      var s = document.createElement("script");
      s.src = "js/muse-runtime.js";
      s.onload = function () {
        if (window.MuseRuntime) resolve(window.MuseRuntime);
        else reject(new Error("muse-runtime.js loaded but did not expose MuseRuntime"));
      };
      s.onerror = function () { reject(new Error("failed to load muse-runtime.js")); };
      document.head.appendChild(s);
    });
    return enginePromise;
  }

  // ── chart rendering ─────────────────────────────────────────────────

  var PALETTE = ["#c78bf5", "#f2b134", "#7c5cfc", "#a78bfa", "#4bc46a"];

  function drawChart(canvas, bars, chartCommands, fills, equity) {
    var dpr = window.devicePixelRatio || 1;
    var cssW = canvas.clientWidth, cssH = canvas.clientHeight;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    var priceH = cssH * 0.66;
    var eqH = cssH - priceH - 10;
    var padL = 4, padR = 4;
    var plotW = cssW - padL - padR;
    var n = bars.length;

    var closes = bars.map(function (b) { return b.close; });
    var lo = Math.min.apply(null, closes), hi = Math.max.apply(null, closes);
    var pad = (hi - lo) * 0.08 || 1;
    lo -= pad; hi += pad;

    function xAt(i) { return padL + (i / (n - 1)) * plotW; }
    function yAt(v, top, h) { return top + (1 - (v - lo) / (hi - lo)) * h; }

    // grid
    ctx.strokeStyle = "rgba(154,143,178,0.12)";
    ctx.lineWidth = 1;
    for (var g = 0; g <= 4; g++) {
      var gy = (priceH / 4) * g + 0.5;
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(cssW, gy); ctx.stroke();
    }

    // price area fill
    var grad = ctx.createLinearGradient(0, 0, 0, priceH);
    grad.addColorStop(0, "rgba(199,139,245,0.28)");
    grad.addColorStop(1, "rgba(199,139,245,0.0)");
    ctx.beginPath();
    ctx.moveTo(xAt(0), yAt(closes[0], 0, priceH));
    for (var i = 1; i < n; i++) ctx.lineTo(xAt(i), yAt(closes[i], 0, priceH));
    ctx.lineTo(xAt(n - 1), priceH);
    ctx.lineTo(xAt(0), priceH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // price line
    ctx.beginPath();
    ctx.moveTo(xAt(0), yAt(closes[0], 0, priceH));
    for (var i2 = 1; i2 < n; i2++) ctx.lineTo(xAt(i2), yAt(closes[i2], 0, priceH));
    ctx.strokeStyle = "#c78bf5";
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // indicator overlays (grouped by label, scaled independently onto the price pane if they roughly
    // track price scale, else onto a normalized 0..1 band at the top third — keeps rsi/prob-style
    // series readable without swamping the price line).
    var byLabel = {};
    chartCommands.forEach(function (c) {
      if (c.kind !== "plot") return;
      (byLabel[c.label] = byLabel[c.label] || []).push(c);
    });
    var labelNames = Object.keys(byLabel);
    labelNames.forEach(function (label, li) {
      var pts = byLabel[label];
      // Indicators like sma()/rsi() return NaN during their warmup window
      // (not enough bars yet). Math.min/max are NaN-poisoned by a single
      // NaN anywhere in the array, and classifying/scaling off that
      // poisoned range previously rendered every point at one constant
      // fallback height — a solid-looking but entirely fake flat dashed
      // line at the top of the chart. Filter to finite values FIRST, for
      // both the classification bounds and everything drawn.
      var finitePts = pts.filter(function (p) { return isFinite(p.series); });
      if (!finitePts.length) return;
      var vals = finitePts.map(function (p) { return p.series; });
      var sortedVals = vals.slice().sort(function (a, b) { return a - b; });
      var vmed = sortedVals[Math.floor(sortedVals.length / 2)];
      var vlo = Math.min.apply(null, vals), vhi = Math.max.apply(null, vals);
      var overlaysPrice = vmed <= hi * 1.5 && vmed >= lo * 0.5 && (vhi - vlo) > 0.001 * (hi - lo || 1);
      ctx.beginPath();
      ctx.strokeStyle = PALETTE[li % PALETTE.length];
      ctx.lineWidth = 1.3;
      ctx.setLineDash(overlaysPrice ? [] : [3, 3]);
      var started = false;
      finitePts.forEach(function (p, idx) {
        var v = overlaysPrice ? p.series : (vhi > vlo ? (p.series - vlo) / (vhi - vlo) : 0.5);
        var y = overlaysPrice
          ? Math.max(0, Math.min(priceH, yAt(p.series, 0, priceH)))
          : (priceH * 0.06 + (1 - v) * priceH * 0.28);
        var x = xAt(p.barIndex != null ? p.barIndex : idx);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // trade markers
    (fills || []).forEach(function (f) {
      var x = xAt(f.bar);
      var y = yAt(closes[Math.min(f.bar, n - 1)], 0, priceH);
      ctx.beginPath();
      if (f.kind === "long") {
        ctx.fillStyle = "#4bc46a";
        ctx.moveTo(x, y + 8); ctx.lineTo(x - 5, y + 16); ctx.lineTo(x + 5, y + 16);
      } else if (f.kind === "short") {
        ctx.fillStyle = "#f0506e";
        ctx.moveTo(x, y - 8); ctx.lineTo(x - 5, y - 16); ctx.lineTo(x + 5, y - 16);
      } else {
        ctx.fillStyle = "#9a8fb2";
        ctx.arc(x, y, 3, 0, Math.PI * 2);
      }
      ctx.closePath();
      ctx.fill();
    });

    // equity mini-panel
    if (equity && equity.length) {
      var eTop = priceH + 10;
      var elo = Math.min.apply(null, equity), ehi = Math.max.apply(null, equity);
      var epad = (ehi - elo) * 0.1 || 1;
      elo -= epad; ehi += epad;
      ctx.strokeStyle = "rgba(154,143,178,0.12)";
      ctx.beginPath(); ctx.moveTo(0, eTop); ctx.lineTo(cssW, eTop); ctx.stroke();
      var egrad = ctx.createLinearGradient(0, eTop, 0, eTop + eqH);
      egrad.addColorStop(0, "rgba(75,196,106,0.25)");
      egrad.addColorStop(1, "rgba(75,196,106,0.0)");
      function eyAt(v) { return eTop + (1 - (v - elo) / (ehi - elo)) * eqH; }
      ctx.beginPath();
      ctx.moveTo(xAt(0), eyAt(equity[0]));
      for (var j = 1; j < equity.length; j++) ctx.lineTo(xAt(j), eyAt(equity[j]));
      ctx.lineTo(xAt(equity.length - 1), eTop + eqH);
      ctx.lineTo(xAt(0), eTop + eqH);
      ctx.closePath();
      ctx.fillStyle = egrad;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(xAt(0), eyAt(equity[0]));
      for (var j2 = 1; j2 < equity.length; j2++) ctx.lineTo(xAt(j2), eyAt(equity[j2]));
      ctx.strokeStyle = "#4bc46a";
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    return labelNames.map(function (l, i) { return { label: l, color: PALETTE[i % PALETTE.length] }; });
  }

  // ── wiring ───────────────────────────────────────────────────────────

  function fmt(n, d) {
    if (n == null || !isFinite(n)) return "—";
    return n.toFixed(d == null ? 2 : d);
  }

  function init() {
    var root = document.getElementById("demo");
    if (!root) return;

    var select = document.getElementById("demo-select");
    var runBtn = document.getElementById("demo-run");
    var tierBtns = root.querySelectorAll(".demo-tier-btn");
    var codeEl = document.getElementById("demo-code");
    var blurbEl = document.getElementById("demo-blurb");
    var tagsEl = document.getElementById("demo-tags");
    var legendEl = document.getElementById("demo-legend");
    var canvas = document.getElementById("demo-canvas");
    var statusEl = document.getElementById("demo-status");
    var metricsEl = document.getElementById("demo-metrics");
    var parityEl = document.getElementById("demo-parity");

    var tier = "js";
    var current = EXAMPLES[0];

    EXAMPLES.forEach(function (ex, i) {
      var opt = document.createElement("option");
      opt.value = ex.id; opt.textContent = ex.label;
      select.appendChild(opt);
    });

    function selectExample(id) {
      current = EXAMPLES.filter(function (e) { return e.id === id; })[0] || EXAMPLES[0];
      select.value = current.id;
      var displaySrc = current.displaySourceMarker
        ? current.source.replace(cloudLiteral, current.displaySourceMarker)
        : current.source;
      codeEl.innerHTML = highlight(displaySrc);
      blurbEl.textContent = current.blurb;
      tagsEl.innerHTML = current.tags.map(function (t) {
        return '<span class="bench-tag">' + t + "</span>";
      }).join("");
    }

    function setTier(t) {
      tier = t;
      tierBtns.forEach(function (b) {
        b.classList.toggle("active", b.dataset.tier === t);
      });
    }

    tierBtns.forEach(function (b) {
      b.addEventListener("click", function () { setTier(b.dataset.tier); });
    });
    select.addEventListener("change", function () { selectExample(select.value); });

    function run() {
      statusEl.textContent = "loading engine…";
      statusEl.className = "demo-status";
      runBtn.disabled = true;
      loadEngine().then(function (MuseRuntime) {
        var bars = current.tape(N_BARS, SEED);
        var t0 = performance.now();
        var res = MuseRuntime.run(current.source, bars, { tier: tier });
        var t1 = performance.now();

        if (!res.ok) {
          statusEl.textContent = "✗ " + res.error;
          statusEl.className = "demo-status demo-status-err";
          runBtn.disabled = false;
          return;
        }

        var legend = drawChart(canvas, bars, res.chart || [], res.fills || [], res.equity || []);
        legendEl.innerHTML =
          '<span class="demo-legend-item"><i style="background:#c78bf5"></i>close</span>' +
          '<span class="demo-legend-item"><i style="background:#4bc46a"></i>equity</span>' +
          legend.map(function (l) {
            return '<span class="demo-legend-item"><i style="background:' + l.color + '"></i>' + l.label + "</span>";
          }).join("");

        metricsEl.innerHTML = [
          ["Sharpe", fmt(res.sharpe)],
          ["Trades", String(res.trades)],
          ["Win rate", res.winRate != null ? fmt(res.winRate * 100, 0) + "%" : "—"],
          ["Final equity", "$" + fmt(res.finalEquity, 0)]
        ].map(function (pair) {
          return '<div class="demo-metric"><span class="demo-metric-num">' + pair[1] +
            '</span><span class="demo-metric-lbl">' + pair[0] + "</span></div>";
        }).join("");

        statusEl.textContent = "✓ backend: " + res.backend + " · " + bars.length + " bars in " + (t1 - t0).toFixed(2) + "ms, in your browser";
        statusEl.className = "demo-status demo-status-ok";
        runBtn.disabled = false;

        // Cross-tier parity check, run silently on the other tier — the same
        // guarantee the test suite enforces (max delta 0 across hosts),
        // shown live instead of just claimed.
        var otherTier = tier === "js" ? "interp" : "js";
        var otherRes = MuseRuntime.run(current.source, bars, { tier: otherTier });
        if (otherRes.ok && otherRes.trades === res.trades &&
            Math.abs(otherRes.finalEquity - res.finalEquity) < 0.01) {
          parityEl.textContent = "✓ identical result on interp & js — same source, same answer";
          parityEl.className = "demo-parity demo-parity-ok";
        } else if (otherRes.ok) {
          parityEl.textContent = "⚠ tiers diverged (" + otherTier + ": " + otherRes.trades + " trades) — flagging, not hiding it";
          parityEl.className = "demo-parity demo-parity-warn";
        } else {
          parityEl.textContent = "";
        }
      }).catch(function (err) {
        statusEl.textContent = "✗ " + err.message;
        statusEl.className = "demo-status demo-status-err";
        runBtn.disabled = false;
      });
    }

    runBtn.addEventListener("click", run);
    selectExample(EXAMPLES[0].id);

    // Auto-run the first example once it scrolls into view, so the section
    // never sits there looking inert.
    var ran = false;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting && !ran) { ran = true; run(); io.disconnect(); }
      });
    }, { threshold: 0.3 });
    io.observe(root);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
