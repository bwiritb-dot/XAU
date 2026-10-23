// Собирает lab/viewer/index.html: свечи PAXG (gzip + base64), наборы из lab/out/results.json, движок lab/engine.mjs.
// Запуск: node lab/viewer/build.mjs  (нужны lab/data/PAXGUSDT.json и lab/out/results.json)
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LAB = join(HERE, "..");

// Переменные поиска → параметры движка (как to_engine в optimize.py).
export function toEngine(x) {
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  const p = { ...x };
  for (const k of ["tp2Gap", "tp3Gap", "split", "be1Share", "be2Share", "timeOn"]) delete p[k];
  const tp1 = x.tp1, tp2 = tp1 + x.tp2Gap, tp3 = tp2 + x.tp3Gap;
  const [f1, f2] = x.split.split("/").map(Number);
  return Object.assign(p, {
    tp1: r4(tp1), tp2: r4(tp2), tp3: r4(tp3), f1, f2,
    be1: r4(x.be1Share * tp1), be2: r4(x.be2Share * tp2), timeLimit: x.timeOn ? Math.trunc(x.timeLimit) : 0,
  });
}

const secOf = (d) => Date.parse(d + "T00:00:00Z") / 1000;

export function buildSets(res, defaults) {
  const out = {};
  for (const [strat, S] of Object.entries(res.strategies)) {
    const list = [{ id: "orig", label: "Оригинал", sub: "параметры app.js", params: { ...defaults[strat] } }];
    S.windows.forEach((W, i) => {
      const win = res.windows[i];
      for (const [name, lbl] of [["optuna", "Optuna"], ["grid", "сетка"]]) {
        if (!W[name]) continue;
        list.push({
          id: `k${W.k}-${name}`, label: `Окно ${W.k} · ${lbl}`, sub: `проверка ${win.test[0].slice(0, 7)} – ${win.test[1].slice(0, 7)}`,
          params: { ...defaults[strat], ...toEngine(W[name].x) },
          train: win.train, test_: win.test, trainSec: win.train.map(secOf), testSec: win.test.map(secOf),
          test: W.test[name]?.m ?? null,
        });
      }
    });
    out[strat] = list;
  }
  return out;
}

function packCandles(rows) {
  const d = { t0: rows[0][0] - 900, dt: [], c: [], o: [], h: [], l: [], v: [] };
  let pt = d.t0, pc = 0;
  for (const r of rows) {
    const c = Math.round(r[4] * 100);
    d.dt.push((r[0] - pt) / 900); pt = r[0];
    d.c.push(c - pc); pc = c;
    d.o.push(Math.round(r[1] * 100) - c); d.h.push(Math.round(r[2] * 100) - c); d.l.push(Math.round(r[3] * 100) - c);
    d.v.push(Math.round(r[5] * 1e6));
  }
  return gzipSync(JSON.stringify(d), { level: 9 }).toString("base64");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { DEFAULTS } = await import("../engine.mjs");
  const res = JSON.parse(readFileSync(join(LAB, "out", "results.json"), "utf8"));
  const rows = JSON.parse(readFileSync(join(LAB, "data", "PAXGUSDT.json"), "utf8")).rows;
  const engine = readFileSync(join(LAB, "engine.mjs"), "utf8").replace(/^export /gm, "");
  const page = readFileSync(join(HERE, "template.html"), "utf8")
    .replace("/*__ENGINE__*/", () => engine)
    .replace("/*__SETS__*/null", () => JSON.stringify(buildSets(res, DEFAULTS)))
    .replace("/*__DATA__*/", () => packCandles(rows));
  writeFileSync(join(HERE, "index.html"), page);
  console.log(`lab/viewer/index.html: ${(page.length / 1e6).toFixed(2)} МБ`);
}
