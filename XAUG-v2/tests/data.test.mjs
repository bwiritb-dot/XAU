import test from "node:test";
import assert from "node:assert/strict";
import { mapRestKline, mapWsKline, applyKline } from "../src/data.js";

test("REST-свеча разбирается как в оригинале", () => {
  const k = [1754179200000, "3350.1", "3352.0", "3349.5", "3351.2", "120.5", 0, "0", 0, "70.25"];
  assert.deepEqual(mapRestKline(k), {
    time: 1754179200, open: 3350.1, high: 3352.0, low: 3349.5, close: 3351.2,
    volume: 120.5, takerBuy: 70.25, delta: 2.0 * 70.25 - 120.5,
  });
});

test("WS-свеча разбирается как в оригинале", () => {
  const k = { t: 1754179200000, o: "1", h: "2", l: "0.5", c: "1.5", v: "10", V: "6", x: true };
  assert.deepEqual(mapWsKline(k), {
    time: 1754179200, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, takerBuy: 6, delta: 2, isClosed: true,
  });
});

test("незакрытая свеча с тем же временем заменяет последнюю", () => {
  const data = [{ time: 1 }, { time: 2, close: 10 }];
  applyKline(data, { time: 2, close: 11 });
  assert.equal(data.length, 2);
  assert.equal(data[1].close, 11);
});

test("новая свеча добавляется в конец", () => {
  const data = [{ time: 1 }, { time: 2 }];
  applyKline(data, { time: 3 });
  assert.deepEqual(data.map((d) => d.time), [1, 2, 3]);
});

test("пустой массив свечей не трогается (как в оригинале)", () => {
  const data = [];
  applyKline(data, { time: 3 });
  assert.equal(data.length, 0);
});
