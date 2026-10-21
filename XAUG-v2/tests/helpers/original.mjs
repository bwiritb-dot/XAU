// Запускает оригинальный app.js в песочнице vm с заглушкой DOM.
import fs from "node:fs";
import vm from "node:vm";
import { APP_JS } from "../../tools/build-core.mjs";

let api = null;

export function loadOriginal() {
  if (api) return api;
  const el = new Proxy(function () {}, {
    get: (t, k) => {
      if (k === "style" || k === "classList" || k === "dataset") return new Proxy({}, { get: () => () => {}, set: () => true });
      if (k === "querySelector") return () => el;
      if (k === "querySelectorAll") return () => [];
      if (typeof k === "string" && /^(add|remove|append|set|insert|click|focus)/.test(k)) return () => {};
      return el;
    },
    set: () => true,
    apply: () => el,
  });
  const doc = { getElementById: () => el, querySelector: () => el, querySelectorAll: () => [], addEventListener: () => {}, createElement: () => el, body: el, readyState: "loading" };
  const ctx = {
    document: doc, window: { addEventListener: () => {} }, console: { log() {}, warn() {}, error() {} },
    setInterval: () => 0, setTimeout: () => 0, clearInterval() {}, Date, Math, JSON, Set, Map,
    parseFloat, isNaN, Number, String, Array, Object, Infinity,
    localStorage: { getItem: () => null, setItem() {} }, LightweightCharts: {},
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const src = fs.readFileSync(APP_JS, "utf8") + `
;globalThis.__api = {
  calculateIndicators, calculateWSBOrderFlow,
  run(data, strategy, state) {
    activeStrategy = strategy; historicalTrades = []; wsbCurrentState = state;
    let m = []; candleSeries = { setMarkers: x => m = x };
    updateTradeMarkers(data); return m;
  }
};`;
  vm.runInContext(src, ctx);
  api = ctx.__api;
  return api;
}

// JSON-круг убирает разницу «объект из другого realm» для deepStrictEqual.
const plain = (x) => JSON.parse(JSON.stringify(x));

export function originalPipeline(bars, strategy) {
  const A = loadOriginal();
  const data = structuredClone(bars);
  A.calculateIndicators(data);
  const wsb = A.calculateWSBOrderFlow(data);
  return { markers: plain(A.run(data, strategy, wsb)) };
}
