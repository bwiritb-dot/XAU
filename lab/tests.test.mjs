// Сверка движка с core.js на фикстуре — без сети и без lab/data. Запуск: node --test lab/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parity } from "./check.mjs";

const raw = JSON.parse(readFileSync(new URL("../XAUG-v2/tests/fixtures/klines.json", import.meta.url), "utf8"));
const rows = raw.map((k) => [Math.floor(k[0] / 1000), +k[1], +k[2], +k[3], +k[4], +k[5], +k[9]]);

for (const s of ["wsb", "mr"]) {
  test(`движок = core.js на фикстуре: ${s}`, () => {
    const r = parity(rows, s);
    assert.ok(r.core > 0);
    assert.deepEqual({ onlyCore: r.onlyCore, onlyMine: r.onlyMine, same: r.same }, { onlyCore: [], onlyMine: [], same: true });
  });
}
