import test from "node:test";
import assert from "node:assert/strict";
import { pipeline } from "../src/data.js";
import { wsbSignals, mrSignals, openTrade } from "../src/explain.js";
import { renderWsb } from "../src/ui/panel-wsb.js";
import { renderMr } from "../src/ui/panel-mr.js";
import { renderRuler } from "../src/ui/ruler.js";
import { hasLetters } from "../src/wordless.js";
import { windowBars } from "./helpers/fixture.mjs";

globalThis.document = { getElementById: () => null };
const visible = (html) => html.replace(/<[^>]*>/g, " ");

function renderAll(w) {
  const wsbRun = pipeline(windowBars(w), "wsb");
  const ws = wsbSignals(wsbRun.data, wsbRun.wsb);
  const mrRun = pipeline(windowBars(w), "mr");
  const ms = mrSignals(mrRun.data, mrRun.markers);
  const last = wsbRun.data[wsbRun.data.length - 1];
  return [
    renderWsb({ data: wsbRun.data, wsb: wsbRun.wsb, signal: ws[ws.length - 1] || null }),
    renderMr({ data: mrRun.data, signal: ms[ms.length - 1] || null }),
    renderRuler({ trade: openTrade(ws, wsbRun.data), price: last ? last.close : undefined }),
  ];
}

for (const w of [[2000, 3000], [2955, 3000], [2975, 3000]]) {
  test(`панели без букв и без NaN/undefined (окно ${w}, ${w[1] - w[0]} свечей)`, () => {
    for (const html of renderAll(w)) {
      assert.equal(typeof html, "string");
      assert.equal(hasLetters(visible(html)), false, visible(html).slice(0, 300));
    }
  });
}

test("WSB-панель: 5 мини-свечей и блок баллов", () => {
  const [wsbHtml] = renderAll([2000, 3000]);
  assert.equal((wsbHtml.match(/class="mc"/g) || []).length, 5);
  assert.match(wsbHtml, /class="score"/);
});

test("панель Разворота: 5 условий, 12 клеток, 8 ламп", () => {
  const [, mrHtml] = renderAll([2000, 3000]);
  assert.equal((mrHtml.match(/class="arm-row"/g) || []).length, 5);
  assert.equal((mrHtml.match(/class="cell /g) || []).length, 12);
  assert.equal((mrHtml.match(/class="lamp /g) || []).length, 8);
});

test("линейка без сделки — пустой блок", () => {
  assert.match(renderRuler({ trade: null, price: 1 }), /class="ruler empty"/);
});
