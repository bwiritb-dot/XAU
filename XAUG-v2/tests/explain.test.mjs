import test from "node:test";
import assert from "node:assert/strict";
import { pipeline } from "../src/data.js";
import { wsbSignals, mrSignals, mrBarState, explainBreakout, tradeState } from "../src/explain.js";
import { WINDOWS, windowBars } from "./helpers/fixture.mjs";

globalThis.document = { getElementById: () => null };
const LONG_WINDOWS = WINDOWS.filter(([a, b]) => b - a >= 1000);
const isEntry = (m) => m.shape === "arrowUp" || m.shape === "arrowDown";
const key = (time, dir, prob) => `${time}_${dir}_${prob}`;
const markerKey = (m) => key(m.time, m.shape === "arrowUp" ? "LONG" : "SHORT", parseInt(m.text.split(" ")[1], 10));
const exitKey = (e) => `${e.time}|${e.text}|${e.color}`;

for (const w of LONG_WINDOWS) {
  test(`WSB: сигналы = стрелки оригинала, раскладка = «процент» (${w})`, () => {
    const { data, wsb, markers } = pipeline(windowBars(w), "wsb");
    const sigs = wsbSignals(data, wsb);
    assert.deepEqual(sigs.map((s) => key(s.time, s.dir, s.prob)).sort(), markers.filter(isEntry).map(markerKey).sort());
    for (const s of sigs) {
      assert.equal(s.explain.total, s.prob);
      assert.equal(s.explain.raw, s.explain.base + s.explain.factors.reduce((a, f) => a + f.pts, 0));
    }
  });

  test(`WSB: выходы из сделок = квадраты оригинала (${w})`, () => {
    const { data, wsb, markers } = pipeline(windowBars(w), "wsb");
    const mine = wsbSignals(data, wsb).flatMap((s) => tradeState(s, data).events).map(exitKey).sort();
    assert.deepEqual(mine, markers.filter((m) => !isEntry(m)).map(exitKey).sort());
  });

  test(`Разворот: раскладка = «процент», вход = правила (${w})`, () => {
    const { data, markers } = pipeline(windowBars(w), "mr");
    const sigs = mrSignals(data, markers);
    for (const s of sigs) {
      assert.equal(s.explain.total, s.prob);
      assert.equal(mrBarState(data, s.idx).entry, s.dir);
    }
  });

  test(`Разворот: последовательный проход по правилам даёт ровно стрелки оригинала (${w})`, () => {
    const { data, markers } = pipeline(windowBars(w), "mr");
    const expected = [];
    let busyUntil = -1; // индекс выхода открытой сделки; Infinity — сделка не закрыта
    for (let i = 25; i < data.length; i++) {
      if (i < busyUntil) continue; // на свече выхода оригинал разрешает новый вход
      const st = mrBarState(data, i);
      if (!st.entry) continue;
      const sig = { strategy: "mr", idx: i, time: data[i].time, dir: st.entry, entry: data[i].close };
      const ts = tradeState(sig, data);
      expected.push(`${sig.time}_${sig.dir}`);
      busyUntil = ts.open ? Infinity : ts.events[ts.events.length - 1].idx;
    }
    const orig = markers.filter(isEntry).map((m) => `${m.time}_${m.shape === "arrowUp" ? "LONG" : "SHORT"}`);
    assert.deepEqual(expected, orig);
  });

  test(`Разворот: выходы = квадраты оригинала (${w})`, () => {
    const { data, markers } = pipeline(windowBars(w), "mr");
    const mine = mrSignals(data, markers).flatMap((s) => tradeState(s, data).events).map(exitKey).sort();
    assert.deepEqual(mine, markers.filter((m) => !isEntry(m)).map(exitKey).sort());
  });
}

test("нулевой объём: δ-ratio = 0, без NaN", () => {
  const bars = windowBars([2000, 3000]).map((b) => ({ ...b, volume: 0, takerBuy: 0, delta: 0 }));
  const { data, wsb } = pipeline(bars, "wsb");
  const box = wsb.allBoxes.find((b) => b.breakoutOccurred);
  assert.ok(box, "в окне есть пробой");
  const e = explainBreakout(box, box.breakoutBar, data, box.endIdx);
  const delta = e.factors.find((f) => f.key === "delta");
  assert.equal(delta.value, 0);
  assert.ok(e.factors.every((f) => Number.isFinite(f.pts)));
  assert.ok(Number.isFinite(e.total));
});
