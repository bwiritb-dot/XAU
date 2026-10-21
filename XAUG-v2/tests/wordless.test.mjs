import test from "node:test";
import assert from "node:assert/strict";
import { toWordless, hasLetters } from "../src/wordless.js";

const m = (shape, text, color = "#10b981") => ({ time: 1, position: "belowBar", color, shape, text, size: 2 });

test("вход: остаётся только число «процента»", () => {
  assert.equal(toWordless(m("arrowUp", "W 88%")).text, "88");
  assert.equal(toWordless(m("arrowDown", "R 71%")).text, "71");
});

test("тейки: квадрат с процентом", () => {
  for (const [src, out] of [["■ +0.50% (50% TP1)", "+0.50"], ["■ +0.75% (25% TP2)", "+0.75"], ["■ +1.00% (25% TP3)", "+1.00"]]) {
    const r = toWordless(m("square", src));
    assert.equal(r.text, out);
    assert.equal(r.shape, "square");
  }
});

test("стопы: круг с итогом", () => {
  for (const [src, out] of [["■ [РОЙ: -1.04%] (Stop Loss)", "-1.04"], ["■ [РОЙ: +0.00%] (Б/У Стоп 50%)", "+0.00"], ["■ [РОЙ: +0.50%] (Стоп +0.5% 25%)", "+0.50"]]) {
    const r = toWordless(m("square", src));
    assert.equal(r.text, out);
    assert.equal(r.shape, "circle");
  }
});

test("ни в одной метке нет букв, время и цвет сохранены", () => {
  const src = m("square", "■ [РОЙ: -0.61%] (Stop Loss)", "#f43f5e");
  const r = toWordless(src);
  assert.equal(hasLetters(r.text), false);
  assert.equal(r.time, src.time);
  assert.equal(r.color, src.color);
});

test("hasLetters ловит латиницу, кириллицу, NaN, undefined", () => {
  assert.equal(hasLetters("+0.50 / 88 $3350.1 12:45"), false);
  for (const s of ["W", "Стоп", "NaN", "undefined"]) assert.equal(hasLetters(s), true);
});
