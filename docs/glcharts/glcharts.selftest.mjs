// glcharts.selftest.mjs — node self-test for glcharts' PURE layers: viewport math, geometry
// builders, theme resolution/color parsing. The GL/overlay/interaction layers need a browser and
// are exercised by the demo harness (glcharts-demo.html) + Playwright later.
//   node src/glcharts/glcharts.selftest.mjs

import {
  createViewport, setSize, fitRight, visibleRange, indexToX, xToIndex,
  priceToY, yToPrice, panPx, zoomAt, clampRight, autoFitPrice, niceTicks,
  timeTicks, pricePrecisionFor,
} from "./core/viewport.js";
import {
  normalizeBars, buildCandleInstances, buildVolumeInstances, buildLineStrip, buildAreaStrip,
} from "./series/geometry.js";
import { resolveTheme, parseColor, DARK } from "./theme.js";
import { hitTestBar, hitTestDrawing, plotToAnchor, distToSegment } from "./interact/hitTest.js";
import { createDrawing, serializeDrawings, deserializeDrawings } from "./drawings/store.js";
import { TOOLS, pointsNeeded, FIB_LEVELS } from "./drawings/tools.js";
import { heartbeatIntensity } from "./series/volatility.js";
import { computeSynesthesia, volumeMass, provenanceSoftness, temperatureColor, buildLocalVol, buildGravityWellStrip, returnSkew, drawdownStats } from "./series/synesthesia.js";
import { buildVwap, buildAuroraStrip, buildVwapLeash, updateBassHits, updateSonicRing } from "./series/sensoryExtras.js";
import { applySensoryClarity, resolveIntensity, SENSORY_INTENSITY, resolveMotionTier } from "./series/sensoryClarity.js";
import {
  computePsionic, applyPsionic, receptionClarity, buildPrecursorScores,
  empathicIntent, buildAstralProjection,
} from "./series/sensoryPsionic.js";
import {
  sma, ema, bollinger, rsi, macd, atr, vwapSeries, createIndicatorInstance,
  computeIndicator, computeAllIndicators, listIndicatorDefs, paneStackHeight,
} from "./series/indicators.js";

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  ok   - ${name}`); }
  else { fail++; console.log(`  FAIL - ${name}`); }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// ── viewport: projection round-trips ────────────────────────────────────────────────────
console.log("viewport projection:");
const vp = createViewport();
setSize(vp, 800, 400);
vp.barSpace = 10;
fitRight(vp, 100); // right = 99 + 2 offset = 101
check("fitRight anchors newest+offset", vp.right === 101);
check("index→x→index round trip", near(xToIndex(vp, indexToX(vp, 42)), 42));
check("newest bar sits left of the right edge", indexToX(vp, 99) === 800 - 2 * 10);
vp.priceMin = 50; vp.priceMax = 150;
check("price→y→price round trip", near(yToPrice(vp, priceToY(vp, 77.7)), 77.7));
check("priceMax maps to y=0", priceToY(vp, 150) === 0);
check("priceMin maps to y=height", priceToY(vp, 50) === 400);

// ── viewport: pan/zoom semantics ────────────────────────────────────────────────────────
console.log("pan/zoom:");
const before = vp.right;
panPx(vp, 100); // drag right 100px → look 10 bars into the past
check("pan right rewinds by px/barSpace", near(vp.right, before - 10));
const anchorIdx = xToIndex(vp, 400);
zoomAt(vp, 2, 400);
check("zoom doubles barSpace", near(vp.barSpace, 20));
check("zoom keeps anchor bar under cursor", near(xToIndex(vp, 400), anchorIdx));
vp.right = 1e9;
clampRight(vp, 100);
check("clamp stops scrolling past the newest bar", vp.right <= 100 - 1 + 800 / vp.barSpace);
vp.right = -1e9;
clampRight(vp, 100);
check("clamp stops scrolling past the oldest bar", vp.right >= 1);

// ── viewport: price auto-fit ────────────────────────────────────────────────────────────
console.log("autoFitPrice:");
const bars = [];
for (let i = 0; i < 200; i++) {
  const c = 100 + Math.sin(i / 10) * 20;
  bars.push({ t: 1700000000 + i * 86400, o: c - 1, h: c + 3, l: c - 3, c, v: 1000 + i });
}
setSize(vp, 800, 400);
vp.barSpace = 8;
fitRight(vp, bars.length);
autoFitPrice(vp, bars);
const vis = visibleRange(vp);
const i0 = Math.max(0, Math.floor(vis.from)), i1 = Math.min(bars.length - 1, Math.ceil(vis.to));
const lows = bars.slice(i0, i1 + 1).map((b) => b.l);
const highs = bars.slice(i0, i1 + 1).map((b) => b.h);
check("fit covers visible lows", vp.priceMin < Math.min(...lows));
check("fit covers visible highs", vp.priceMax > Math.max(...highs));
const noVol = { min: vp.priceMin, max: vp.priceMax };
autoFitPrice(vp, bars, { volumeFrac: 0.2 });
check("volume band adds bottom headroom", vp.priceMin < noVol.min && near(vp.priceMax, noVol.max, 1e-6));

// ── ticks ───────────────────────────────────────────────────────────────────────────────
console.log("ticks:");
const ticks = niceTicks(97.3, 132.8, 6);
check("nice ticks inside range", ticks.every((t) => t >= 97.3 && t <= 132.8));
check("nice ticks on 1/2/5 ladder", ticks.length >= 3 && ticks.every((t) => near(t % 5, 0) || near(t % 5, 5)));
const tt = timeTicks(vp, bars, 72);
check("time ticks respect min label px", tt.every((x, i) => i === 0 || (x.i - tt[i - 1].i) * vp.barSpace >= 72));
check("time ticks carry bar timestamps", tt.every(({ i, t }) => bars[i].t === t));

console.log("pricePrecisionFor:");
check("BTC-level → 1dp", pricePrecisionFor(64000) === 1);
check("sub-dollar → 6dp", pricePrecisionFor(0.083) === 6);
check("garbage → 2dp", pricePrecisionFor(NaN) === 2);

// ── geometry builders ───────────────────────────────────────────────────────────────────
console.log("geometry:");
const messy = [
  { t: 300, o: 3, h: 4, l: 2, c: 3.5, v: 10 },
  { t: 100, o: 1, h: 2, l: 0.5, c: 1.5, v: 5 },
  { t: 300, o: 3, h: 5, l: 2, c: 4, v: 12 },   // dup t — last wins
  { t: 200, o: NaN, h: NaN, l: NaN, c: 2, v: NaN },
  null,
];
const norm = normalizeBars(messy);
check("normalize sorts+dedups+drops", norm.length === 3 && norm[2].c === 4);
check("partial bar backfilled from close", norm[1].o === 2 && norm[1].v === 0);
check("normalize preserves provenance", normalizeBars([
  { t: 1, o: 1, h: 1, l: 1, c: 1, v: 0, provenance: "mid_as_ohlc" },
])[0].provenance === "mid_as_ohlc");

const cand = buildCandleInstances(norm);
check("candle instances stride 5", cand.length === norm.length * 5);
check("candle instance carries [idx,o,h,l,c]", cand[5] === 1 && cand[6] === 2 && cand[9] === 2);

const { data: vol, vMax } = buildVolumeInstances(norm);
check("volume stride 3 + vMax", vol.length === 9 && vMax === 12);
check("volume dir sign", vol[2] === 1 && vol[8] === 1);

const strip = buildLineStrip(norm);
check("line strip is 2 verts/point × 8 floats", strip.length === norm.length * 2 * 8);
check("line strip sides alternate", strip[6] === 1 && strip[14] === -1);
check("line strip endpoints self-reference", strip[2] === 0 && strip[3] === norm[0].c);

const areaStrip = buildAreaStrip(norm);
check("area strip alternates line/baseline", areaStrip[2] === 0 && areaStrip[5] === 1);

// ── theme ───────────────────────────────────────────────────────────────────────────────
console.log("theme:");
check("named theme resolves", resolveTheme("light").name === "light");
check("unknown falls back to dark", resolveTheme("neon") === DARK);
const patched = resolveTheme({ up: "#123456", axis: { rightWidth: 80 } });
check("patch deep-merges", patched.up === "#123456" && patched.axis.rightWidth === 80 && patched.axis.bottomHeight === DARK.axis.bottomHeight);
const [r, g, b, a] = parseColor("#ff8000", 0.5);
check("hex parse + alpha", near(r, 1) && near(g, 128 / 255) && b === 0 && a === 0.5);
const rgba = parseColor("rgba(139,147,167,0.25)");
check("rgba parse", near(rgba[0], 139 / 255) && near(rgba[3], 0.25));

// ── hit-testing + drawings ─────────────────────────────────────────────────────────────
console.log("hitTest:");
const htVp = createViewport();
setSize(htVp, 500, 300);
htVp.barSpace = 10;
htVp.priceMin = 90;
htVp.priceMax = 110;
fitRight(htVp, bars.length);
const midI = bars.length - 20;
const midX = indexToX(htVp, midI);
check("hitTestBar snaps to candle under cursor", hitTestBar(htVp, bars, midX) === midI);
check("hitTestBar rejects empty x past series", hitTestBar(htVp, bars, indexToX(htVp, bars.length + 50)) === -1);
const anchor = plotToAnchor(htVp, bars, midX, 150);
check("plotToAnchor returns bar timestamp", anchor && anchor.t === bars[midI].t && Number.isFinite(anchor.value));
check("distToSegment midpoint is ~0", near(distToSegment(5, 5, 0, 0, 10, 10), 0, 1e-9));

console.log("drawings:");
check("all tools registered", Object.keys(TOOLS).length >= 5);
check("segment needs 2 points", pointsNeeded("segment") === 2);
check("hline needs 1 point", pointsNeeded("horizontalStraightLine") === 1);
check("vline needs 1 point", pointsNeeded("verticalStraightLine") === 1);
check("channel needs 3 points", pointsNeeded("parallelStraightLine") === 3);
check("fib levels include 0.618", FIB_LEVELS.includes(0.618));
const d1 = createDrawing("segment", [
  { t: bars[10].t, value: 100 },
  { t: bars[30].t, value: 105 },
]);
const d2 = createDrawing("horizontalStraightLine", [{ t: bars[20].t, value: 102 }]);
const ser = serializeDrawings([d1, d2]);
check("serialize keeps both", ser.length === 2 && ser[0].name === "segment");
const round = deserializeDrawings(ser);
check("deserialize round-trip", round.length === 2 && round[0].points[0].t === d1.points[0].t);
check("deserialize drops corrupt", deserializeDrawings([{ name: "segment", points: [{ t: 1 }] }]).length === 0);

const drawings = [d1, d2];
const segHit = hitTestDrawing(htVp, bars, drawings, indexToX(htVp, 10), priceToY(htVp, 100), { handleRadius: 12 });
check("hitTestDrawing finds segment handle", segHit && segHit.drawingId === d1.id && segHit.handleIndex === 0);
const hHit = hitTestDrawing(htVp, bars, drawings, 50, priceToY(htVp, 102), { handleRadius: 2, lineSlop: 4 });
check("hitTestDrawing finds hline body", hHit && hHit.drawingId === d2.id);

console.log("heartbeat vol:");
const calm = [];
for (let i = 0; i < 60; i++) calm.push({ t: i, o: 100, h: 100.1, l: 99.9, c: 100 + Math.sin(i) * 0.05, v: 1 });
const wild = [];
for (let i = 0; i < 60; i++) wild.push({ t: i, o: 100, h: 110, l: 90, c: 100 * Math.exp((Math.sin(i * 0.7) * 0.08)), v: 1 });
const vCalm = createViewport(); setSize(vCalm, 400, 200); vCalm.barSpace = 8; fitRight(vCalm, calm.length);
const vWild = createViewport(); setSize(vWild, 400, 200); vWild.barSpace = 8; fitRight(vWild, wild.length);
const iCalm = heartbeatIntensity(vCalm, calm);
const iWild = heartbeatIntensity(vWild, wild);
check("calm series has lower intensity than wild", iCalm < iWild);
check("intensity stays in (0,1]", iCalm > 0 && iCalm <= 1 && iWild > 0 && iWild <= 1);

console.log("synesthesia:");
const synVp = createViewport(); setSize(synVp, 400, 200); synVp.barSpace = 8; fitRight(synVp, bars.length);
const s0 = computeSynesthesia(synVp, bars, null, 0.016);
const s1 = computeSynesthesia(synVp, bars, s0, 0.016);
check("syn state has vol/temp/mass", s0.vol > 0 && s0.temp > 0 && s0.mass > 0);
check("temp eases smoothly", Math.abs(s1.temp - s0.temp) < 0.2);
check("flat bars → soft provenance", provenanceSoftness([
  { t: 1, o: 1, h: 1, l: 1, c: 1, v: 0, provenance: "mid_as_ohlc" },
  { t: 2, o: 1, h: 1, l: 1, c: 1, v: 0 },
]) === 1);
const tc = temperatureColor([0, 0, 1], [1, 0, 0], 0.5);
check("temperature mid-blend", near(tc[0], 0.5) && near(tc[2], 0.5));
check("volumeMass in range", (() => { const m = volumeMass(synVp, bars); return m >= 0.08 && m <= 1; })());

const lv = buildLocalVol(bars);
check("localVol length matches bars", lv.length === bars.length);
check("localVol normalized", Math.max(...lv) <= 1.0001 && Math.min(...lv) >= 0);
const gw = buildGravityWellStrip(bars.slice(0, 30));
check("gravity well strip stride 4", gw.length === 30 * 2 * 4);
const dd = drawdownStats(synVp, bars);
check("drawdown depth in range", dd.depth >= 0 && dd.depth <= 1);
check("returnSkew in [-1,1]", (() => { const s = returnSkew(synVp, bars); return s >= -1 && s <= 1; })());

console.log("sensory extras:");
const vwap = buildVwap(bars);
check("vwap length matches bars", vwap.length === bars.length);
check("vwap finite", Number.isFinite(vwap[0]) && Number.isFinite(vwap[vwap.length - 1]));
const aur = buildAuroraStrip(bars);
check("aurora strip verts = 2n", aur.length === bars.length * 2 * 3);
const leash = buildVwapLeash(bars, vwap, 20);
check("vwap leash verts = 2*tail", leash.count === Math.min(20, bars.length) * 2);
const spikeBars = bars.map((b, i) => ({ ...b, v: i === bars.length - 1 ? 1e9 : (b.v || 1) }));
const hits = updateBassHits(synVp, spikeBars, [], 10);
check("bass hit fires on volume spike", hits.some((h) => h.i === spikeBars.length - 1));
const ringBars = [
  ...bars.slice(0, -2),
  { ...bars[bars.length - 2], c: 100 },
  { ...bars[bars.length - 1], c: 104 },
];
const ring = updateSonicRing(ringBars, null, 5);
check("sonic ring fires on impulse", !!ring && ring.strength > 0);
check("theme has aurora/vwap tokens", !!(DARK.synesthesia?.aurora && DARK.synesthesia?.vwap));

console.log("sensory clarity:");
check("intensity presets exist", !!(SENSORY_INTENSITY.gentle && SENSORY_INTENSITY.vivid));
check("gentle is steadier than vivid", resolveIntensity("gentle").steady && !resolveIntensity("vivid").steady);
const rawSyn = computeSynesthesia(synVp, bars, null, 0.016);
const gentle = applySensoryClarity(rawSyn, "gentle", null);
const vivid = applySensoryClarity(rawSyn, "vivid", null);
check("gentle gains down vol vs vivid", gentle.vol <= vivid.vol + 1e-9);
check("gentle pins periodScale", gentle.periodScale === 1);
check("clarity carries intensity name", gentle.intensity === "gentle");
const flashed = applySensoryClarity({ ...rawSyn, regimeFlash: 1, regimeSign: 1 }, "balanced", null);
check("regime arrow telegraphs flip", !!flashed.regimeArrow && flashed.regimeArrow.sign === 1);
const minimal = applySensoryClarity(rawSyn, "vivid", null, "minimal");
check("minimal motion zeros motion gain", minimal.preset.motion === 0);
check("minimal forces steady", minimal.periodScale === 1 && minimal.animate === false);
check("motion tier resolver", resolveMotionTier("reduced").motion < 1);

console.log("psionic:");
const psi0 = computePsionic(synVp, bars, null, 0.016, rawSyn);
const psi1 = computePsionic(synVp, bars, psi0, 0.016, rawSyn);
check("psi has reception/precog", psi0.reception > 0 && psi0.precog >= 0);
check("reception in range", receptionClarity(bars) >= 0 && receptionClarity(bars) <= 1);
const prec = buildPrecursorScores(bars);
check("precursor length matches", prec.length === bars.length);
check("empathic intent in [-1,1]", (() => { const i = empathicIntent(synVp, bars); return i >= -1 && i <= 1; })());
const proj = buildAstralProjection(bars, 6);
check("astral projection has path", !!proj && proj.path.length === 6);
const withPsi = applyPsionic(gentle, psi0, "gentle");
check("applyPsionic attaches psi", !!withPsi.psi && withPsi.psi.reception === psi0.reception);
check("psi eases across frames", Math.abs(psi1.reception - psi0.reception) < 0.3);
check("theme has psi tokens", !!(DARK.synesthesia?.psi && DARK.synesthesia?.astral));
check("empty bars → safe psi", computePsionic(synVp, [], null, 0.016).reception === 0.5);
check("empty vwap/aurora safe", buildVwap([]).length === 0 && buildAuroraStrip([]).length === 0);

console.log("indicators:");
const closes = bars.map((b) => b.c);
const ma = sma(closes, 20);
check("sma warms up then finite", ma[19] != null && Number.isFinite(ma[19]) && ma[10] == null);
const em = ema(closes, 12);
check("ema finite after seed", em[20] != null && Number.isFinite(em[20]));
const bb = bollinger(closes, 20, 2);
check("bollinger bands ordered", bb.upper[30] > bb.mid[30] && bb.mid[30] > bb.lower[30]);
const rsiVals = rsi(closes, 14);
check("rsi in 0..100", rsiVals.filter((x) => x != null).every((x) => x >= 0 && x <= 100));
const m = macd(closes);
check("macd has lines", m.macd.some((x) => x != null) && m.signal.some((x) => x != null));
const atrVals = atr(bars, 14);
check("atr positive", atrVals.filter((x) => x != null).every((x) => x > 0));
check("vwapSeries length", vwapSeries(bars).length === bars.length);
check("indicator catalog", listIndicatorDefs().length >= 7);
const inst = createIndicatorInstance("MA", { n: 20 });
const computed = computeIndicator(bars, inst);
check("compute MA overlay", computed?.target === "overlay" && computed.series.mid.length === bars.length);
const rsiInst = createIndicatorInstance("RSI");
const all = computeAllIndicators(bars, [inst, rsiInst]);
check("computeAll includes pane", all.length === 2 && all.some((x) => x.target === "pane"));
check("pane stack height > 0", paneStackHeight(all, { plotH: 400 }) > 0);

console.log("log scale:");
const logVp = createViewport();
setSize(logVp, 400, 200);
logVp.logScale = true;
logVp.priceMin = 100;
logVp.priceMax = 400;
const midY = priceToY(logVp, 150);
const linY = 200 * (1 - (150 - 100) / (400 - 100));
check("log mid not linear mid", Math.abs(midY - linY) > 5);
check("log y→price roundtrip", near(yToPrice(logVp, priceToY(logVp, 250)), 250, 1e-6));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
