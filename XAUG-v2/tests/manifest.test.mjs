import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const m = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

test("MV3, без всплывающего окна, сеть только к Binance", () => {
  assert.equal(m.manifest_version, 3);
  assert.equal(m.action.default_popup, undefined);
  assert.deepEqual(m.host_permissions, ["https://fapi.binance.com/*", "wss://fstream.binance.com/*"]);
  assert.match(m.content_security_policy.extension_pages, /script-src 'self'/);
});

test("все файлы, на которые ссылается index.html, существуют", () => {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  for (const [, p] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    assert.ok(fs.existsSync(new URL(`../${p}`, import.meta.url)), p);
  }
});
