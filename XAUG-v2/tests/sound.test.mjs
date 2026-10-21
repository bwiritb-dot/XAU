import test from "node:test";
import assert from "node:assert/strict";
import { shouldAlert } from "../src/ui/sound.js";
import { isDeathZone } from "../src/core.js";
import { fixtureBars } from "./helpers/fixture.mjs";

const bars = fixtureBars();
const liveBar = bars.find((b) => !isDeathZone(b.time));
const deadBar = bars.find((b) => isDeathZone(b.time));
const entryAt = (t) => [{ time: t, shape: "arrowUp", text: "W 80%" }];

test("новая стрелка на закрытой свече — звук", () => {
  assert.equal(shouldAlert(entryAt(liveBar.time), liveBar, new Set()), true);
});

test("та же свеча второй раз — тишина", () => {
  const alerted = new Set();
  shouldAlert(entryAt(liveBar.time), liveBar, alerted);
  assert.equal(shouldAlert(entryAt(liveBar.time), liveBar, alerted), false);
});

test("зона смерти — тишина", () => {
  assert.equal(shouldAlert(entryAt(deadBar.time), deadBar, new Set()), false);
});

test("только выход (квадрат) — тишина", () => {
  assert.equal(shouldAlert([{ time: liveBar.time, shape: "square", text: "■ +0.50% (50% TP1)" }], liveBar, new Set()), false);
});
