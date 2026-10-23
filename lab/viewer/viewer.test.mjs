// Наборы страницы дают те же итоги на проверке, что и optimize.py (results.json). Нужны lab/data и lab/out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { buildSets } from "./build.mjs";
import { DEFAULTS, makeDataset, run, metrics, indexAt } from "../engine.mjs";

const RES = new URL("../out/results.json", import.meta.url), DATA = new URL("../data/PAXGUSDT.json", import.meta.url);
test("наборы страницы = наборы optimize.py на 6 мес проверки", { skip: !existsSync(DATA) && "нет lab/data" }, () => {
  const res = JSON.parse(readFileSync(RES, "utf8"));
  const ds = makeDataset(JSON.parse(readFileSync(DATA, "utf8")).rows);
  const sets = buildSets(res, DEFAULTS);
  let checked = 0;
  for (const [strat, list] of Object.entries(sets)) {
    for (const s of list.filter((x) => x.test)) {
      const e0 = indexAt(ds, s.testSec[0]), e1 = indexAt(ds, s.testSec[1]);
      const m = metrics(run(strat, ds, s.params, Math.max(0, e0 - 1000), Math.min(ds.n, e1 + 3000), e0, e1));
      assert.equal(m.trades, s.test.trades, `${strat} ${s.id}`);
      assert.ok(Math.abs(m.total - s.test.total) < 1e-6, `${strat} ${s.id}: ${m.total} vs ${s.test.total}`);
      checked++;
    }
  }
  assert.ok(checked >= 30);
});
