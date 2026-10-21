import test from "node:test";
import assert from "node:assert/strict";
import { scoreBlock, gauge, num } from "../src/ui/parts.js";
import { hasLetters } from "../src/wordless.js";

const visible = (html) => html.replace(/<[^>]*>/g, " ");

const score = { base: 56, raw: 81, total: 81, clamp: [68, 94], factors: [
  { key: "wicks", max: 12, pts: 8, value: 4, steps: [5, 8, 12] },
  { key: "delta", max: 12, pts: 4, value: 0.05, steps: [4, 8, 12] },
  { key: "dirMatch", max: 8, pts: 8, value: 1 },
  { key: "z", max: 6, pts: 0, value: 0.4 },
  { key: "vwap", max: 5, pts: 5, value: 1.2 },
  { key: "impulse", max: 4, pts: 0, value: 0.5 },
] };

test("scoreBlock: итог крупно, строк столько же, сколько факторов, букв нет", () => {
  const html = scoreBlock(score, "#10b981");
  assert.match(html, /class="total"[^>]*>81</);
  assert.equal((html.match(/class="row /g) || []).length, 6);
  assert.equal(hasLetters(visible(html)), false);
});

test("scoreBlock: несработавший фактор серый", () => {
  const html = scoreBlock(score, "#10b981");
  assert.equal((html.match(/class="row off"/g) || []).length, 2);
});

test("gauge с нечисловым значением не рисует иглу и не пишет NaN", () => {
  const svg = gauge({ min: 0, max: 100, value: undefined, ticks: [{ v: 40, color: "#10b981" }] });
  assert.equal(svg.includes("NaN"), false);
  assert.equal(svg.includes('class="needle"'), false);
});

test("num: пусто для нечисел", () => {
  assert.equal(num(undefined, 2), "");
  assert.equal(num(NaN, 2), "");
  assert.equal(num(1.234, 2), "1.23");
});
