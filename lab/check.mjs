// Ворота 2–4: сверка движка с core.js, скорость, перенос PAXG → XAUUSDT.
// Запуск: node lab/check.mjs  → lab/out/check.json
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "../XAUG-v2/src/data.js";
import { makeDataset, run, metrics, indexAt } from "./engine.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const load = (s) => JSON.parse(readFileSync(join(HERE, "data", `${s}.json`), "utf8"));

function toCandles(rows) {
  return rows.map((r) => ({
    time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5],
    takerBuy: r[6], delta: 2 * r[6] - r[5],
  }));
}

function markerKind(m) {
  if (m.shape === "arrowUp") return "LONG";
  if (m.shape === "arrowDown") return "SHORT";
  if (m.text.includes("Stop Loss")) return "SL";
  if (m.text.includes("Б/У")) return "BE";
  if (m.text.includes("Стоп +0.5%")) return "P50";
  return m.text.match(/TP\d/)[0];
}

const key = (e) => `${e.t}|${e.kind}${e.pnl != null ? "|" + e.pnl : ""}`;

export function parity(rows, strat) {
  const core = pipeline(toCandles(rows), strat).markers.map((m) => {
    const kind = markerKind(m);
    const pnl = kind === "SL" ? m.text.match(/РОЙ: (-?[\d.]+)%/)[1] : null;
    return key({ t: m.time, kind, pnl });
  });
  const ds = makeDataset(rows);
  const ev = [];
  run(strat, ds, {}, 0, ds.n, 0, ds.n, ev);
  const mine = ev.map((e) => key({ ...e, pnl: e.pnl != null ? e.pnl.toFixed(2) : null }));
  const a = [...core].sort(), b = [...mine].sort();
  const setB = new Set(b), setA = new Set(a);
  const onlyCore = a.filter((x) => !setB.has(x));
  const onlyMine = b.filter((x) => !setA.has(x));
  const same = a.length === b.length && a.every((x, i) => x === b[i]);
  return { strat, core: a.length, engine: b.length, same, onlyCore: onlyCore.slice(0, 5), onlyMine: onlyMine.slice(0, 5) };
}

function fixtureRows() {
  const raw = JSON.parse(readFileSync(join(HERE, "../XAUG-v2/tests/fixtures/klines.json"), "utf8"));
  return raw.map((k) => [Math.floor(k[0] / 1000), +k[1], +k[2], +k[3], +k[4], +k[5], +k[9]]);
}

// Перенос: совпадение входов (та же свеча ±1, то же направление) на общем периоде.
function transfer(paxg, xau, strat) {
  const t0 = xau.t[0], t1 = xau.t[xau.n - 1] + 1;
  const side = (ds) => {
    const i0 = Math.max(0, indexAt(ds, t0) - 1000), e0 = indexAt(ds, t0), e1 = indexAt(ds, t1);
    const tr = run(strat, ds, {}, i0, ds.n, e0, e1);
    return { tr, m: metrics(tr) };
  };
  const P = side(paxg), X = side(xau);
  const px = new Map(P.tr.map((x) => [paxg.t[x.entryIdx], x.dir]));
  let hit = 0;
  for (const x of X.tr) {
    const tt = xau.t[x.entryIdx];
    if ([tt - 900, tt, tt + 900].some((s) => px.get(s) === x.dir)) hit++;
  }
  const share = (hit / Math.max(1, Math.max(P.tr.length, X.tr.length)));
  return { strat, paxg: P.m, xau: X.m, matched: hit, share };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const fx = fixtureRows();
  const xauRows = load("XAUUSDT").rows;
  const out = { parity: [], speed: [], transfer: [] };
  for (const [name, rows] of [["фикстура", fx], ["XAUUSDT 11 мес", xauRows]]) {
    for (const s of ["wsb", "mr"]) {
      const r = { set: name, ...parity(rows, s) };
      out.parity.push(r);
      console.log(`сверка ${name} ${s}: core ${r.core} / движок ${r.engine} → ${r.same ? "100 %" : "РАСХОЖДЕНИЕ"}`,
        r.same ? "" : JSON.stringify({ onlyCore: r.onlyCore, onlyMine: r.onlyMine }));
    }
  }
  const paxg = makeDataset(load("PAXGUSDT").rows);
  for (const s of ["wsb", "mr"]) {
    run(s, paxg, {}, 0, paxg.n);
    const t = performance.now();
    const tr = run(s, paxg, {}, 0, paxg.n);
    const sec = (performance.now() - t) / 1000;
    out.speed.push({ strat: s, candles: paxg.n, sec, trades: tr.length });
    console.log(`скорость ${s}: ${paxg.n} свечей за ${sec.toFixed(2)} с, сделок ${tr.length}`);
  }
  const xau = makeDataset(xauRows);
  for (const s of ["wsb", "mr"]) {
    const r = transfer(paxg, xau, s);
    out.transfer.push(r);
    console.log(`перенос ${s}: PAXG ${r.paxg.trades} сделок, XAU ${r.xau.trades}, совпало ${r.matched} (${(r.share * 100).toFixed(0)} %)`);
  }
  mkdirSync(join(HERE, "out"), { recursive: true });
  writeFileSync(join(HERE, "out", "check.json"), JSON.stringify(out, null, 1));
}
