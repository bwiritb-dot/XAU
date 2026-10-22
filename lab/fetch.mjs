// Свечи 15m с data.binance.vision → lab/data/<SYMBOL>.json.
// Формат файла: { symbol, rows: [[timeSec, open, high, low, close, volume, takerBuy], ...], gaps: [...] }.
// Без зависимостей: zip разбирается вручную (один CSV внутри), работает на Windows.
import { inflateRawSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = "https://data.binance.vision/data";

export const SOURCES = [
  { symbol: "PAXGUSDT", path: "spot", from: "2020-08" },
  { symbol: "XAUUSDT", path: "futures/um", from: "2025-12" },
];

function unzipFirst(buf) {
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error("не zip");
  const method = buf.readUInt16LE(8);
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  // Размер в локальном заголовке бывает 0 (data descriptor) — берём из центрального каталога.
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  const cd = buf.readUInt32LE(eocd + 16);
  const size = buf.readUInt32LE(cd + 20);
  const start = 30 + nameLen + extraLen;
  const body = buf.subarray(start, start + size);
  return (method === 0 ? body : inflateRawSync(body)).toString("utf8");
}

async function get(url, tries = 4) {
  for (let a = 0; ; a++) {
    try {
      const r = await fetch(url);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (a >= tries) throw new Error(`${url}: ${e.message}`);
      await new Promise((res) => setTimeout(res, 2000 * 2 ** a));
    }
  }
}

function parseCsv(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const c = line.trim().split(",");
    if (c.length < 10 || !/^\d+$/.test(c[0])) continue; // заголовок у фьючерсов
    let t = Number(c[0]);
    if (t > 1e14) t = Math.floor(t / 1000); // спот с 2025 — микросекунды
    out.push([Math.floor(t / 1000), +c[1], +c[2], +c[3], +c[4], +c[5], +c[9]]);
  }
  return out;
}

function months(from, until) {
  const out = [];
  let [y, m] = from.split("-").map(Number);
  const [uy, um] = until.split("-").map(Number);
  while (y < uy || (y === uy && m <= um)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

export async function fetchSymbol({ symbol, path, from }, log = console.log) {
  const now = new Date();
  const lastFull = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const ym = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const urls = months(from, ym(lastFull)).map(
    (m) => `${BASE}/${path}/monthly/klines/${symbol}/15m/${symbol}-15m-${m}.zip`);
  // Текущий месяц — дневными архивами до вчера.
  for (let d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)); d < now; d = new Date(d.getTime() + 864e5)) {
    const day = d.toISOString().slice(0, 10);
    urls.push(`${BASE}/${path}/daily/klines/${symbol}/15m/${symbol}-15m-${day}.zip`);
  }
  const rows = [];
  let missing = 0;
  for (let i = 0; i < urls.length; i += 6) {
    const bufs = await Promise.all(urls.slice(i, i + 6).map((u) => get(u)));
    bufs.forEach((b) => { if (b) rows.push(...parseCsv(unzipFirst(b))); else missing++; });
  }
  rows.sort((a, b) => a[0] - b[0]);
  const uniq = rows.filter((r, i) => i === 0 || r[0] !== rows[i - 1][0]);
  const gaps = [];
  for (let i = 1; i < uniq.length; i++) {
    const dt = uniq[i][0] - uniq[i - 1][0];
    if (dt > 3600) gaps.push({ from: uniq[i - 1][0], to: uniq[i][0], hours: +(dt / 3600).toFixed(2) });
  }
  log(`${symbol}: ${uniq.length} свечей, архивов нет: ${missing} (обычно сегодняшний день), дыр > 1 ч: ${gaps.length}`);
  return { symbol, rows: uniq, gaps };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = join(HERE, "data");
  mkdirSync(dir, { recursive: true });
  for (const s of SOURCES) {
    const res = await fetchSymbol(s);
    writeFileSync(join(dir, `${s.symbol}.json`), JSON.stringify(res));
  }
}
