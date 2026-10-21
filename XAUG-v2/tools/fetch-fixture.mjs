// Скачивает фиксированный набор свечей XAUUSDT 15m для тестов сверки.
// Запуск: node tools/fetch-fixture.mjs  (нужен доступ к fapi.binance.com)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, "../tests/fixtures/klines.json");
const START = Date.UTC(2026, 7, 3); // 2026-08-03 00:00 UTC
const TOTAL = 3000;

const rows = [];
let start = START;
while (rows.length < TOTAL) {
  const limit = Math.min(1500, TOTAL - rows.length);
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=XAUUSDT&interval=15m&limit=${limit}&startTime=${start}`;
  const batch = await (await fetch(url)).json();
  if (!Array.isArray(batch) || batch.length === 0) throw new Error(`bad response: ${JSON.stringify(batch).slice(0, 200)}`);
  rows.push(...batch);
  start = batch[batch.length - 1][0] + 900000;
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(rows));
console.log(`${rows.length} bars ${new Date(rows[0][0]).toISOString()} .. ${new Date(rows[rows.length - 1][0]).toISOString()}`);
