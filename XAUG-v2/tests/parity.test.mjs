import test from "node:test";
import assert from "node:assert/strict";
import { pipeline } from "../src/data.js";
import { originalPipeline } from "./helpers/original.mjs";
import { WINDOWS, windowBars } from "./helpers/fixture.mjs";

globalThis.document = { getElementById: () => null };
const plain = (x) => JSON.parse(JSON.stringify(x));

for (const strategy of ["wsb", "mr"]) {
  for (const w of WINDOWS) {
    test(`метки v2 = метки оригинала: ${strategy} ${w.join("-")}`, () => {
      const bars = windowBars(w);
      const mine = pipeline(structuredClone(bars), strategy).markers;
      const orig = originalPipeline(bars, strategy).markers;
      assert.deepStrictEqual(plain(mine), orig);
    });
  }
}

test("в фикстуре вообще есть сигналы (тест не пустой)", () => {
  const n = (s) => pipeline(windowBars([2000, 3000]), s).markers.filter((m) => m.shape !== "square").length;
  assert.ok(n("wsb") >= 5, "WSB");
  assert.ok(n("mr") >= 1, "MR");
});
