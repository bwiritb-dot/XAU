// Процесс-исполнитель для optimize.py: читает JSON по строке из stdin, отвечает строкой в stdout.
// Запрос: { id, strat, sym, from, to, params, trades? } — from/to в секундах UTC, сделки с входом в [from, to).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { makeDataset, run, metrics, indexAt } from "./engine.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const WARMUP = 1000; // как в расширении: 1000 свечей истории
const TAIL = 3000; // запас свечей после окна, чтобы сделки успели закрыться
const cache = {};
const ds = (sym) => (cache[sym] ??= makeDataset(JSON.parse(readFileSync(join(HERE, "data", `${sym}.json`), "utf8")).rows));

function evaluate(q) {
  const d = ds(q.sym);
  const e0 = indexAt(d, q.from), e1 = indexAt(d, q.to);
  const i0 = Math.max(0, e0 - WARMUP), i1 = Math.min(d.n, e1 + TAIL);
  const tr = run(q.strat, d, q.params, i0, i1, e0, e1);
  const out = { id: q.id, m: metrics(tr) };
  if (q.trades) out.trades = tr.map((x) => [d.t[x.entryIdx], d.t[x.exitIdx], x.dir, +x.pnl.toFixed(4)]);
  return out;
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let q;
  try {
    q = JSON.parse(line);
    process.stdout.write(JSON.stringify(evaluate(q)) + "\n");
  } catch (e) {
    process.stdout.write(JSON.stringify({ id: q?.id, error: String(e.stack || e) }) + "\n");
  }
});
