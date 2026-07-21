/* hero-chart.js — canvas-2D FALLBACK for the hero terminal, used only when
 * WebGL2 (and therefore the real glcharts engine) is unavailable. Self-contained
 * animated candlesticks: synthetic price with regime drift + shocks, EMA
 * overlays, a volume strip, trade markers that pop, a glowing last-price dot,
 * and a live price/Δ readout. Exported so hero-gl.js can lazy-load it.
 */
export function runFallbackChart(mount, priceEl, deltaEl) {
  "use strict";

  (function () {
    var cvs = document.createElement("canvas");
    cvs.id = "hero-chart-fallback";
    cvs.style.width = "100%";
    cvs.style.height = "264px";
    cvs.style.display = "block";
    mount.appendChild(cvs);
    var ctx = cvs.getContext("2d");
    var reduce = window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var COL = {
      up: "#4bc46a", down: "#f0506e", ema: "#c78bf5",
      grid: "rgba(154,143,178,0.10)"
    };

    var VISIBLE = 44;          // candles across the pane
    var INTERVAL = 850;        // ms between new candles
    var candles = [];          // {o,h,l,c,v,dir}
    var trades = [];           // {i, side, born}
    var price = 100, vel = 0, tsim = 0, pos = 0, lastFlip = 0;
    var loB = 90, hiB = 110;   // smoothed y-bounds (lerp'd for calm rescaling)

    function nextCandle() {
      tsim += 1;
      var regime = Math.sin(tsim * 0.045) * 0.5 + Math.sin(tsim * 0.013) * 0.32;
      var shock = (Math.random() < 0.055) ? (Math.random() - 0.5) * 4.2 : 0;
      var drift = regime * 0.5 + (Math.random() - 0.5) * 0.9 + shock;
      vel = vel * 0.72 + drift * 0.5;
      var o = price;
      var c = o + vel;
      var hi = Math.max(o, c) + Math.random() * 0.9;
      var lo = Math.min(o, c) - Math.random() * 0.9;
      price = c;
      return { o: o, h: hi, l: lo, c: c, v: 0.25 + Math.random() * 0.75, dir: c >= o ? 1 : -1 };
    }

    for (var s = 0; s < VISIBLE + 2; s++) candles.push(nextCandle());

    function ema(period) {
      var k = 2 / (period + 1), prev = candles[0].c, out = [prev];
      for (var i = 1; i < candles.length; i++) { prev = candles[i].c * k + prev * (1 - k); out.push(prev); }
      return out;
    }

    function maybeTrade() {
      var e = ema(9), n = candles.length - 2;
      if (n < 2) return;
      var crossUp = candles[n].c > e[n] && candles[n - 1].c <= e[n - 1];
      var crossDn = candles[n].c < e[n] && candles[n - 1].c >= e[n - 1];
      if ((crossUp || crossDn) && (tsim - lastFlip) > 4) {
        var side = crossUp ? 1 : -1;
        if (side !== pos) {
          pos = side; lastFlip = tsim;
          trades.push({ i: n, side: side, born: now() });
          if (trades.length > 6) trades.shift();
        }
      }
    }

    function now() { return performance.now(); }
    var lastAppend = now();

    function append(t) {
      candles.push(nextCandle());
      candles.shift();
      for (var k = 0; k < trades.length; k++) trades[k].i -= 1;
      trades = trades.filter(function (tr) { return tr.i > -2; });
      maybeTrade();
      lastAppend = t;
    }

    function size() {
      var dpr = window.devicePixelRatio || 1;
      var w = cvs.clientWidth, h = cvs.clientHeight;
      cvs.width = w * dpr; cvs.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { w: w, h: h };
    }

    function draw(t) {
      var dim = size(), W = dim.w, H = dim.h;
      ctx.clearRect(0, 0, W, H);
      var progress = reduce ? 0 : Math.min(1, (t - lastAppend) / INTERVAL);

      var padL = 8, padR = 8;
      var volH = H * 0.16, priceH = H - volH - 8;
      var step = (W - padL - padR) / VISIBLE;
      var start = 1;                       // candles.length is fixed at VISIBLE+2
      var len = candles.length;

      var e9 = ema(9), e21 = ema(21);
      var lo = Infinity, hi = -Infinity;
      for (var i = start; i < len; i++) {
        lo = Math.min(lo, candles[i].l, e9[i], e21[i]);
        hi = Math.max(hi, candles[i].h, e9[i], e21[i]);
      }
      var pv = (hi - lo) * 0.08 || 1; lo -= pv; hi += pv;
      var lerp = reduce ? 1 : 0.12;
      loB += (lo - loB) * lerp; hiB += (hi - hiB) * lerp;

      function yAt(v) { return (1 - (v - loB) / (hiB - loB)) * priceH; }
      function xAt(idx) { return padL + (idx - start - progress) * step; }

      // grid
      ctx.strokeStyle = COL.grid; ctx.lineWidth = 1;
      for (var g = 0; g <= 3; g++) {
        var gy = (priceH / 3) * g + 0.5;
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
      }

      // area under close
      ctx.beginPath();
      var firstX = null, ix;
      for (ix = 0; ix < len; ix++) {
        var x = xAt(ix), y = yAt(candles[ix].c);
        if (firstX === null) { ctx.moveTo(x, y); firstX = x; } else ctx.lineTo(x, y);
      }
      ctx.lineTo(xAt(len - 1), priceH); ctx.lineTo(firstX, priceH); ctx.closePath();
      var ag = ctx.createLinearGradient(0, 0, 0, priceH);
      ag.addColorStop(0, "rgba(199,139,245,0.16)"); ag.addColorStop(1, "rgba(199,139,245,0)");
      ctx.fillStyle = ag; ctx.fill();

      // volume strip
      var vmax = 0; for (ix = start; ix < len; ix++) vmax = Math.max(vmax, candles[ix].v);
      for (ix = 0; ix < len; ix++) {
        var bh = (candles[ix].v / (vmax || 1)) * volH;
        ctx.fillStyle = candles[ix].dir > 0 ? "rgba(75,196,106,0.26)" : "rgba(240,80,110,0.26)";
        ctx.fillRect(xAt(ix) - step * 0.3, H - bh, step * 0.6, bh);
      }

      // EMAs (draw under candles)
      function drawEma(arr, color, wgt) {
        ctx.beginPath(); var began = false;
        for (var i = 0; i < len; i++) {
          var x = xAt(i), y = yAt(arr[i]);
          if (!began) { ctx.moveTo(x, y); began = true; } else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = color; ctx.lineWidth = wgt; ctx.stroke();
      }
      drawEma(e21, "rgba(242,177,52,0.5)", 1.4);
      drawEma(e9, COL.ema, 1.6);

      // candles
      for (ix = 0; ix < len; ix++) {
        var c = candles[ix], x = xAt(ix), col = c.dir > 0 ? COL.up : COL.down;
        ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, yAt(c.h)); ctx.lineTo(x, yAt(c.l)); ctx.stroke();
        var yo = yAt(c.o), yc = yAt(c.c), top = Math.min(yo, yc), bh2 = Math.max(1, Math.abs(yc - yo));
        ctx.fillRect(x - step * 0.3, top, step * 0.6, bh2);
      }

      // last-price line + glowing dot
      var lp = candles[len - 1].c, ly = yAt(lp), lx = xAt(len - 1);
      ctx.setLineDash([3, 4]); ctx.strokeStyle = "rgba(199,139,245,0.45)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(W, ly); ctx.stroke(); ctx.setLineDash([]);
      var gg = ctx.createRadialGradient(lx, ly, 0, lx, ly, 15);
      gg.addColorStop(0, "rgba(199,139,245,0.5)"); gg.addColorStop(1, "rgba(199,139,245,0)");
      ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(lx, ly, 15, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = COL.ema; ctx.beginPath();
      ctx.arc(lx, ly, reduce ? 3.5 : 3.4 + Math.sin(t * 0.006) * 1.4, 0, Math.PI * 2); ctx.fill();

      // trade markers + pop rings
      for (var tr = 0; tr < trades.length; tr++) {
        var m = trades[tr]; if (m.i < start || m.i >= len) continue;
        var mx = xAt(m.i), my = yAt(candles[m.i].c), mc = m.side > 0 ? COL.up : COL.down;
        var age = t - m.born;
        if (age < 700 && !reduce) {
          ctx.globalAlpha = Math.max(0, 1 - age / 700);
          ctx.strokeStyle = mc; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(mx, my, 6 + age / 700 * 18, 0, Math.PI * 2); ctx.stroke();
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = mc; ctx.beginPath();
        if (m.side > 0) { ctx.moveTo(mx, my + 10); ctx.lineTo(mx - 5, my + 19); ctx.lineTo(mx + 5, my + 19); }
        else { ctx.moveTo(mx, my - 10); ctx.lineTo(mx - 5, my - 19); ctx.lineTo(mx + 5, my - 19); }
        ctx.closePath(); ctx.fill();
      }

      // readout
      var open = candles[start].c, d = (lp - open) / open * 100;
      if (priceEl) priceEl.textContent = lp.toFixed(2);
      if (deltaEl) {
        deltaEl.textContent = (d >= 0 ? "+" : "") + d.toFixed(2) + "%";
        deltaEl.className = "term-delta " + (d >= 0 ? "up" : "down");
      }
    }

    // ── loop with visibility pause ──────────────────────────────────────
    var running = false;
    function loop(t) {
      if (!running) return;
      if (t - lastAppend >= INTERVAL) append(t);
      draw(t);
      requestAnimationFrame(loop);
    }
    function start() { if (running) return; running = true; lastAppend = now(); requestAnimationFrame(loop); }
    function stop() { running = false; }

    if (reduce) {
      for (var w = 0; w < 30; w++) append(now());   // settle to a lively frame
      draw(now());
      window.addEventListener("resize", function () { draw(now()); });
      return;
    }

    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { e.isIntersecting ? start() : stop(); });
      }, { threshold: 0.05 });
      io.observe(cvs);
    } else {
      start();
    }
  })();
}
