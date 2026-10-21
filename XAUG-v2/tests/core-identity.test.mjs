import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { APP_JS, CORE_JS, FUNCTIONS, extractAll, buildCore } from "../tools/build-core.mjs";

const src = fs.readFileSync(APP_JS, "utf8");

test("каждый блок найден и дословно присутствует в app.js", () => {
  const blocks = extractAll(src);
  for (const name of ["CONFIG", ...FUNCTIONS]) {
    assert.ok(blocks[name], `нет блока ${name}`);
    assert.ok(src.includes(blocks[name]), `блок ${name} не совпадает с app.js`);
  }
});

test("каждый вырезанный блок — целая функция (парсится)", () => {
  const blocks = extractAll(src);
  for (const name of FUNCTIONS) {
    assert.doesNotThrow(() => new Function(blocks[name]), name);
  }
});

test("core.js на диске = свежая генерация (руками не правили)", () => {
  assert.equal(fs.readFileSync(CORE_JS, "utf8"), buildCore(src));
});

test("core.js содержит все блоки побайтно", () => {
  const core = fs.readFileSync(CORE_JS, "utf8");
  const blocks = extractAll(src);
  for (const name of ["CONFIG", ...FUNCTIONS]) assert.ok(core.includes(blocks[name]), name);
});
