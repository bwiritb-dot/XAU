"""XAUG lab: база → Optuna → сетка → проверка по скользящим окнам.

Запуск: python lab/optimize.py            (полный прогон, ≈ 2000 прогонов Optuna на окно)
        python lab/optimize.py --quick    (дымовой прогон: 2 окна, 60 прогонов, сетка 3)
Итог: lab/out/results.json → отчёт строит lab/report.py.
"""
import argparse
import itertools
import json
import os
import queue
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import optuna

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
MIN_TRADES = 50  # за 2 года подбора
TRAIN_MONTHS, TEST_MONTHS = 24, 6
FIRST_TRAIN = (2020, 9)

SPLITS = [f"{a}/{b}/{100 - a - b}" for a in (25, 50, 75, 100) for b in range(0, 101 - a, 25)]

# (имя, тип, мин, макс | варианты, по умолчанию, подпись)
TRADE = [
    ("tp1", "float", 0.2, 1.0, 0.5, "TP1, %"),
    ("tp2Gap", "float", 0.05, 0.5, 0.25, "TP2 − TP1, %"),
    ("tp3Gap", "float", 0.05, 0.5, 0.25, "TP3 − TP2, %"),
    ("split", "cat", SPLITS, None, "50/25/25", "Доли TP1/TP2/TP3, %"),
    ("be1Share", "float", 0.0, 1.0, 0.08, "Стоп после TP1, доля пути до TP1"),
    ("be2Share", "float", 0.0, 1.0, 0.6667, "Стоп после TP2, доля пути до TP2"),
    ("timeOn", "cat", [0, 1], None, None, "Лимит времени включён"),
    ("timeLimit", "int", 20, 500, 150, "Лимит времени, свечей"),
]
SPACE = {
    "wsb": [
        ("atrPeriod", "int", 7, 28, 14, "Период ATR"),
        ("wickPct", "float", 30.0, 65.0, 45.0, "Доля тени от свечи, %"),
        ("wickRatio", "float", 1.0, 3.0, 1.5, "Тень / max(тело, другая тень)"),
        ("minRangeAtr", "float", 0.0, 0.8, 0.3, "Мин. размер свечи, ATR"),
        ("boxWin", "int", 3, 8, 5, "Окно бокса, свечей"),
        ("minWicks", "int", 2, 5, 3, "Мин. теней в окне"),
        ("boxEdge", "cat", ["body", "wick"], None, "body", "Границы бокса: тела / тени"),
        ("confirm", "cat", [1, 2], None, 1, "Закрытий для пробоя"),
        ("boxLife", "int", 20, 200, 100, "Жизнь бокса, свечей"),
        ("slAtr", "float", 0.5, 3.0, 1.5, "Стоп, ATR"),
    ] + [(n, k, a, b, (1 if n == "timeOn" else d), lab) for n, k, a, b, d, lab in TRADE],
    "mr": [
        ("bbP", "int", 10, 40, 16, "Боллинджер, период"),
        ("bbSd", "float", 2.0, 4.5, 3.9, "Боллинджер, σ"),
        ("vwapDev", "float", 0.5, 2.5, 1.5, "Отклонение от VWAP, %"),
        ("aoFast", "int", 3, 10, 4, "AO быстрый"),
        ("aoSlow", "int", 34, 150, 96, "AO медленный"),
        ("smiFast", "int", 3, 10, 4, "SMI быстрый"),
        ("smiSlow", "int", 12, 40, 24, "SMI медленный"),
        ("smiSig", "int", 3, 10, 4, "SMI сигнал"),
        ("uoMult", "float", 0.5, 2.0, 1.0, "UO периоды, × (12-24-48)"),
        ("uoLow", "float", 25.0, 45.0, 40.0, "UO порог (зеркально)"),
        ("lrsLen", "int", 5, 20, 7, "LRS период"),
        ("lrsThr", "float", 1.0, 6.0, 3.0, "LRS порог"),
        ("armWin", "int", 3, 30, 12, "Окно взвода, свечей"),
        ("turnsNeed", "int", 2, 4, 3, "Разворотов из 4"),
        ("slLong", "float", 0.3, 2.0, 1.0, "Стоп лонга, %"),
        ("slShort", "float", 0.3, 2.0, 0.75, "Стоп шорта, %"),
    ] + [(n, k, a, b, (0 if n == "timeOn" else d), lab) for n, k, a, b, d, lab in TRADE],
}
NAMES = {"wsb": "WSB A", "mr": "Разворот B"}


def default_x(strat):
    return {n: d for n, _, _, _, d, _ in SPACE[strat]}


def to_engine(x):
    """Переменные поиска → параметры engine.mjs."""
    p = {k: v for k, v in x.items() if k not in ("tp2Gap", "tp3Gap", "split", "be1Share", "be2Share", "timeOn")}
    tp1 = x["tp1"]
    tp2 = tp1 + x["tp2Gap"]
    tp3 = tp2 + x["tp3Gap"]
    f1, f2, _ = (int(v) for v in x["split"].split("/"))
    p.update(tp1=round(tp1, 4), tp2=round(tp2, 4), tp3=round(tp3, 4), f1=f1, f2=f2,
             be1=round(x["be1Share"] * tp1, 4), be2=round(x["be2Share"] * tp2, 4),
             timeLimit=int(x["timeLimit"]) if x["timeOn"] else 0)
    return p


def suggest(trial, strat):
    x = {}
    for n, kind, a, b, _, _ in SPACE[strat]:
        if kind == "int":
            x[n] = trial.suggest_int(n, a, b)
        elif kind == "float":
            x[n] = trial.suggest_float(n, a, b)
        else:
            x[n] = trial.suggest_categorical(n, a)
    return x


class Pool:
    """N процессов node worker.mjs; данные грузятся в каждый один раз."""

    def __init__(self, n):
        cmd = ["node", os.path.join(HERE, "worker.mjs")]
        self.procs = [subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True,
                                       encoding="utf-8", bufsize=1) for _ in range(n)]
        self.free = queue.Queue()
        for p in self.procs:
            self.free.put(p)
        self.ex = ThreadPoolExecutor(n)
        self.calls = 0

    def call(self, q):
        p = self.free.get()
        try:
            p.stdin.write(json.dumps(q) + "\n")
            p.stdin.flush()
            r = json.loads(p.stdout.readline())
        finally:
            self.free.put(p)
        if "error" in r:
            raise RuntimeError(r["error"])
        self.calls += 1
        return r

    def map(self, qs):
        return list(self.ex.map(self.call, qs))

    def close(self):
        for p in self.procs:
            p.stdin.close()
            p.wait()


def ts(y, m):
    y, m = y + (m - 1) // 12, (m - 1) % 12 + 1
    return int(datetime(y, m, 1, tzinfo=timezone.utc).timestamp())


def day(sec):
    return datetime.fromtimestamp(sec, timezone.utc).strftime("%Y-%m-%d")


def make_windows(data_end):
    out, k = [], 0
    y, m = FIRST_TRAIN
    while True:
        tr0 = ts(y, m + k * TEST_MONTHS)
        te0 = ts(y, m + k * TEST_MONTHS + TRAIN_MONTHS)
        if te0 >= data_end:
            return out
        te1 = min(ts(y, m + k * TEST_MONTHS + TRAIN_MONTHS + TEST_MONTHS), data_end)
        out.append({"k": k, "train": [tr0, te0], "test": [te0, te1]})
        k += 1


def feasible(m):
    return m["expectancy"] > 0 and m["trades"] >= MIN_TRADES


def rank_key(m):
    # Приоритет владельца: win rate → RR → сделки. Округление, чтобы RR и сделки
    # что-то решали: win rate до 1 п.п., RR до 0,05.
    return (round(m["winRate"] * 100), round(min(m["rr"], 10) / 0.05), m["trades"])


def best_of(rows):
    """rows: [(x, metrics)] → лучший допустимый или None."""
    ok = [r for r in rows if feasible(r[1])]
    return max(ok, key=lambda r: rank_key(r[1])) if ok else None


def evaluate(pool, strat, xs, period, sym="PAXGUSDT", trades=False):
    qs = [{"id": i, "strat": strat, "sym": sym, "from": period[0], "to": period[1],
           "params": to_engine(x) if x is not None else {}, "trades": trades} for i, x in enumerate(xs)]
    return pool.map(qs)


def run_optuna(pool, strat, win, n_trials, workers, seed):
    # Optuna ≥ 5: ограничения ставятся на прогон; раньше — через constraints_func.
    new_api = hasattr(optuna.trial.Trial, "set_constraint")
    sampler = optuna.samplers.NSGAIISampler(
        seed=seed, **({} if new_api else {"constraints_func": lambda t: t.user_attrs["constraints"]}))
    study = optuna.create_study(directions=["maximize"] * 3, sampler=sampler)
    study.enqueue_trial(default_x(strat))
    rows = []
    while len(rows) < n_trials:
        batch = [study.ask() for _ in range(min(workers * 4, n_trials - len(rows)))]
        xs = [suggest(t, strat) for t in batch]
        res = evaluate(pool, strat, xs, win["train"])
        for t, x, r in zip(batch, xs, res):
            m = r["m"]
            c = [1e-4 - m["expectancy"], MIN_TRADES - m["trades"]]  # ≤ 0 — набор допустим
            if new_api:
                t.set_constraint("expectancy", c[0])
                t.set_constraint("trades", c[1])
            else:
                t.set_user_attr("constraints", c)
            t.set_user_attr("expectancy", m["expectancy"])
            study.tell(t, [m["winRate"], min(m["rr"], 10), m["trades"]])
            rows.append((x, m))
    imp = {}
    # 16 деревьев глубины 8: на 2000 прогонах ≈ 1 с вместо ≈ 2 мин (64 дерева без ограничения глубины)
    ev = optuna.importance.FanovaImportanceEvaluator(n_trees=16, max_depth=8, seed=seed)
    for name, target in (("winRate", lambda t: t.values[0]), ("expectancy", lambda t: t.user_attrs["expectancy"])):
        imp[name] = optuna.importance.get_param_importances(study, evaluator=ev, target=target, normalize=True)
    return rows, imp


def grid_values(strat, name, n):
    _, kind, a, b, _, _ = next(s for s in SPACE[strat] if s[0] == name)
    if kind == "cat":
        return list(a)
    if kind == "int":
        return sorted({round(a + (b - a) * i / (n - 1)) for i in range(n)})
    return [round(a + (b - a) * i / (n - 1), 4) for i in range(n)]


def stability(strat, xs):
    """Нормированное расстояние между лучшими наборами соседних окон (0 — одинаковые, 1 — противоположные)."""
    out = []
    for a, b in zip(xs, xs[1:]):
        if a is None or b is None:
            out.append(None)
            continue
        ds = []
        for n, kind, lo, hi, _, _ in SPACE[strat]:
            if kind == "cat":
                ds.append(0.0 if a[n] == b[n] else 1.0)
            else:
                ds.append(abs(a[n] - b[n]) / (hi - lo))
        out.append(round(sum(ds) / len(ds), 3))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--trials", type=int, default=2000)
    ap.add_argument("--grid", type=int, default=5, help="значений на переменную сетки")
    ap.add_argument("--top", type=int, default=5, help="переменных в сетке")
    ap.add_argument("--workers", type=int, default=os.cpu_count() or 4)
    ap.add_argument("--windows", type=int, default=0, help="ограничить число окон (0 — все)")
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--seed", type=int, default=42)
    a = ap.parse_args()
    if a.quick:
        a.trials, a.grid, a.windows = 60, 3, 2
    optuna.logging.set_verbosity(optuna.logging.WARNING)
    os.makedirs(OUT, exist_ok=True)
    t_start = time.time()

    def load_meta(sym):
        with open(os.path.join(HERE, "data", f"{sym}.json"), encoding="utf-8") as f:
            d = json.load(f)
        return {"first": d["rows"][0][0], "last": d["rows"][-1][0], "n": len(d["rows"]), "gaps": d["gaps"]}

    meta = {s: load_meta(s) for s in ("PAXGUSDT", "XAUUSDT")}
    data_end = meta["PAXGUSDT"]["last"] + 900
    xau_from = meta["XAUUSDT"]["first"] + 1000 * 900  # после прогрева 1000 свечей
    xau_to = meta["XAUUSDT"]["last"] + 900
    windows = make_windows(data_end)
    if a.windows:
        windows = windows[-a.windows:]
    pool = Pool(a.workers)
    log = lambda s: print(f"[{time.time() - t_start:7.0f} с] {s}", flush=True)
    log(f"окон {len(windows)}, процессов {a.workers}, прогонов Optuna {a.trials}, сетка {a.top}×{a.grid}")

    res = {"config": {"trials": a.trials, "grid": a.grid, "top": a.top, "workers": a.workers, "seed": a.seed,
                      "minTrades": MIN_TRADES, "trainMonths": TRAIN_MONTHS, "testMonths": TEST_MONTHS},
           "meta": meta, "xauPeriod": [xau_from, xau_to],
           "windows": [{"k": w["k"], "train": [day(w["train"][0]), day(w["train"][1])],
                        "test": [day(w["test"][0]), day(w["test"][1])]} for w in windows],
           "space": {s: [{"name": n, "kind": k, "lo": lo if k != "cat" else None, "hi": hi,
                          "choices": lo if k == "cat" else None, "default": d, "label": lab}
                         for n, k, lo, hi, d, lab in SPACE[s]] for s in SPACE},
           "strategies": {}}

    for strat in ("wsb", "mr"):
        S = {"name": NAMES[strat], "windows": []}
        # 1) Optuna по окнам
        for w in windows:
            rows, imp = run_optuna(pool, strat, w, a.trials, a.workers, a.seed + w["k"])
            base = evaluate(pool, strat, [None], w["train"])[0]["m"]
            b = best_of(rows)
            front = sorted([r for r in rows if feasible(r[1])], key=lambda r: rank_key(r[1]), reverse=True)[:20]
            S["windows"].append({
                "k": w["k"], "trainBase": base, "importance": imp,
                "feasible": sum(feasible(m) for _, m in rows),
                "optuna": {"x": b[0], "train": b[1]} if b else None,
                "top": [{"x": x, "m": m} for x, m in front],
            })
            log(f"{strat} окно {w['k']}: Optuna {len(rows)}, допустимых {S['windows'][-1]['feasible']}, "
                f"лучший WR {b[1]['winRate']:.3f} RR {b[1]['rr']:.2f} сделок {b[1]['trades']}" if b else
                f"{strat} окно {w['k']}: допустимых наборов нет")

        # 2) Сетка: 5 самых важных (среднее по окнам, цель win rate) × 5 значений
        names = [s[0] for s in SPACE[strat]]
        mean_imp = {n: sum(W["importance"]["winRate"].get(n, 0) for W in S["windows"]) / len(S["windows"])
                    for n in names}
        top = [n for n, _ in sorted(mean_imp.items(), key=lambda kv: -kv[1])[:a.top]]
        values = {n: grid_values(strat, n, a.grid) for n in top}
        combos = list(itertools.product(*(range(len(values[n])) for n in top)))
        S["importanceMean"] = mean_imp
        S["grid"] = {"vars": top, "values": values, "points": len(combos)}
        cells = {}  # (i, j, vi, vj) → [sum wr, sum exp, count]
        for w, W in zip(windows, S["windows"]):
            basex = W["optuna"]["x"] if W["optuna"] else default_x(strat)
            xs = []
            for c in combos:
                x = dict(basex)
                x.update({n: values[n][ci] for n, ci in zip(top, c)})
                xs.append(x)
            out = evaluate(pool, strat, xs, w["train"])
            rows = [(x, r["m"]) for x, r in zip(xs, out)]
            b = best_of(rows)
            W["grid"] = {"x": b[0], "train": b[1]} if b else None
            W["gridFeasible"] = sum(feasible(m) for _, m in rows)
            for c, (_, m) in zip(combos, rows):
                for i, j in itertools.combinations(range(len(top)), 2):
                    cell = cells.setdefault((i, j, c[i], c[j]), [0.0, 0.0, 0])
                    cell[0] += m["winRate"]
                    cell[1] += m["expectancy"]
                    cell[2] += 1
            log(f"{strat} окно {w['k']}: сетка {len(rows)}, допустимых {W['gridFeasible']}")
        S["grid"]["pairs"] = [{"a": top[i], "b": top[j], "cells": [[vi, vj, s[0] / s[2], s[1] / s[2]]
                               for (ii, jj, vi, vj), s in cells.items() if (ii, jj) == (i, j)]}
                              for i, j in itertools.combinations(range(len(top)), 2)]

        # 3) Проверка: оригинал / Optuna / сетка на 6 мес после каждого окна + XAUUSDT по тем же отрезкам
        for w, W in zip(windows, S["windows"]):
            sets = {"orig": None, "optuna": W["optuna"]["x"] if W["optuna"] else None,
                    "grid": W["grid"]["x"] if W["grid"] else None}
            W["test"], W["xau"] = {}, {}
            for name, x in sets.items():
                if name != "orig" and x is None:
                    continue
                r = evaluate(pool, strat, [x], w["test"], trades=True)[0]
                W["test"][name] = {"m": r["m"], "trades": r["trades"]}
                lo, hi = max(w["test"][0], xau_from), min(w["test"][1], xau_to)
                if lo < hi:
                    r = evaluate(pool, strat, [x], [lo, hi], sym="XAUUSDT", trades=True)[0]
                    W["xau"][name] = {"m": r["m"], "trades": r["trades"], "period": [day(lo), day(hi)]}
        S["stability"] = {k: stability(strat, [W[k]["x"] if W.get(k) else None for W in S["windows"]])
                          for k in ("optuna", "grid")}
        # Набор для торговли — лучший последнего окна; для справки — его итог на всех 11 мес XAUUSDT
        last = S["windows"][-1]
        S["final"] = {}
        for name in ("optuna", "grid"):
            if last.get(name):
                x = last[name]["x"]
                r = evaluate(pool, strat, [x], [xau_from, xau_to], sym="XAUUSDT")[0]
                S["final"][name] = {"x": x, "engine": to_engine(x), "xauAll": r["m"]}
        r = evaluate(pool, strat, [None], [xau_from, xau_to], sym="XAUUSDT")[0]
        S["final"]["orig"] = {"xauAll": r["m"]}
        res["strategies"][strat] = S
        log(f"{strat}: готово")

    res["elapsedSec"] = round(time.time() - t_start)
    res["calls"] = pool.calls
    pool.close()
    with open(os.path.join(OUT, "results.json"), "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False)
    log(f"готово: {pool.calls} прогонов → lab/out/results.json")


if __name__ == "__main__":
    sys.exit(main())
