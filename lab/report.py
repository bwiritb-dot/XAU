"""lab/out/results.json + lab/out/check.json → lab/report.html (один файл, без внешних библиотек)."""
import html
import json
import os
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
SETS = [("orig", "Оригинал"), ("optuna", "Лучший Optuna"), ("grid", "Лучший сетки")]
SERIES = {"orig": "var(--s-orig)", "optuna": "var(--s1)", "grid": "var(--s2)"}


def esc(s):
    return html.escape(str(s))


def day(sec):
    return datetime.fromtimestamp(sec, timezone.utc).strftime("%Y-%m-%d")


def stats(trades):
    """trades: [[entry, exit, dir, pnl]] → итоги так же, как metrics() в engine.mjs."""
    tr = sorted(trades, key=lambda t: t[1])
    n = len(tr)
    wins = [t[3] for t in tr if t[3] > 0]
    loss = [t[3] for t in tr if t[3] <= 0]
    eq = peak = dd = 0.0
    for t in tr:
        eq += t[3]
        peak = max(peak, eq)
        dd = max(dd, peak - eq)
    aw = sum(wins) / len(wins) if wins else 0
    al = -sum(loss) / len(loss) if loss else 0
    return {"trades": n, "winRate": len(wins) / n if n else 0, "rr": aw / al if al > 0 else (99 if wins else 0),
            "expectancy": eq / n if n else 0, "total": eq, "maxDD": dd}


def fmt_m(m):
    if not m or not m["trades"]:
        return "<td>0</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td>"
    return (f"<td>{m['trades']}</td><td>{m['winRate'] * 100:.1f} %</td><td>{min(m['rr'], 99):.2f}</td>"
            f"<td class='{'pos' if m['expectancy'] > 0 else 'neg'}'>{m['expectancy']:+.3f} %</td>"
            f"<td class='{'pos' if m['total'] > 0 else 'neg'}'>{m['total']:+.1f} %</td><td>{m['maxDD']:.1f} %</td>")


M_HEAD = "<th>Сделок</th><th>Win rate</th><th>RR</th><th>Ср. сделка</th><th>Сумма</th><th>Макс. просадка</th>"


def stitched(S, key, name):
    out = []
    for W in S["windows"]:
        part = W.get(key, {}).get(name)
        if part:
            out += part["trades"]
    return out


def line_chart(cid, series, title):
    """series: [(key, label, trades)] → SVG ступенчатых кривых суммы PnL по времени выхода."""
    pts = {}
    for key, label, trades in series:
        eq, p = 0.0, []
        for t in sorted(trades, key=lambda t: t[1]):
            eq += t[3]
            p.append((t[1], round(eq, 3)))
        pts[key] = (label, p)
    allp = [q for _, p in pts.values() for q in p]
    if not allp:
        return f"<p class='muted'>{esc(title)}: сделок нет.</p>"
    W, H, L, R, T, B = 760, 280, 44, 150, 12, 28
    x0, x1 = min(q[0] for q in allp), max(q[0] for q in allp)
    y0, y1 = min(0, min(q[1] for q in allp)), max(0, max(q[1] for q in allp))
    pad = (y1 - y0) * 0.06 or 1
    y0, y1 = y0 - pad, y1 + pad
    sx = lambda x: L + (x - x0) / max(1, x1 - x0) * (W - L - R)
    sy = lambda y: T + (y1 - y) / (y1 - y0) * (H - T - B)
    g = []
    step = nice_step((y1 - y0) / 5)
    v = step * (int(y0 / step) - 1)
    while v <= y1:
        if v >= y0:
            g.append(f"<line class='grid' x1='{L}' x2='{W - R}' y1='{sy(v):.1f}' y2='{sy(v):.1f}'/>"
                     f"<text class='tick' x='{L - 6}' y='{sy(v) + 4:.1f}' text-anchor='end'>{v:+g}</text>")
        v += step
    g.append(f"<line class='base' x1='{L}' x2='{W - R}' y1='{sy(0):.1f}' y2='{sy(0):.1f}'/>")
    for k in range(5):
        x = x0 + (x1 - x0) * k / 4
        g.append(f"<text class='tick' x='{sx(x):.1f}' y='{H - 8}' text-anchor='middle'>{day(x)[:7]}</text>")
    lines, labels, data = [], [], []
    last_y = []
    for key, (label, p) in pts.items():
        if not p:
            continue
        d = f"M{sx(x0):.1f},{sy(0):.1f}"
        prev = 0
        for x, y in p:
            d += f"H{sx(x):.1f}V{sy(y):.1f}"
            prev = y
        lines.append(f"<path d='{d}' fill='none' stroke='{SERIES[key]}' stroke-width='2' stroke-linejoin='round'/>")
        ly = sy(prev)
        for o in last_y:  # подписи справа не налезают друг на друга
            if abs(ly - o) < 14:
                ly = o + 14 if ly >= o else o - 14
        last_y.append(ly)
        labels.append(f"<text class='dl' x='{W - R + 6}' y='{ly + 4:.1f}'>{esc(label)} {prev:+.1f} %</text>")
        data.append({"label": label, "color": SERIES[key], "p": p})
    meta = json.dumps({"x0": x0, "x1": x1, "L": L, "R": R, "W": W, "T": T, "B": B, "H": H, "y0": y0, "y1": y1,
                       "series": data})
    return (f"<figure class='chart'><figcaption>{esc(title)}</figcaption>"
            f"<div class='plot' data-line='{esc(meta)}'><svg viewBox='0 0 {W} {H}' role='img' aria-label='{esc(title)}'>"
            f"{''.join(g)}{''.join(lines)}{''.join(labels)}<line class='xhair' y1='{T}' y2='{H - B}'/></svg>"
            f"<div class='tip'></div></div></figure>")


def nice_step(raw):
    import math
    if raw <= 0:
        return 1
    e = 10 ** math.floor(math.log10(raw))
    for m in (1, 2, 2.5, 5, 10):
        if m * e >= raw:
            return m * e
    return 10 * e


def legend(keys):
    return "<div class='legend'>" + "".join(
        f"<span><i style='background:{SERIES[k]}'></i>{esc(lbl)}</span>" for k, lbl in SETS if k in keys) + "</div>"


def bars(imp, labels, title):
    items = sorted(imp.items(), key=lambda kv: -kv[1])
    mx = max([v for _, v in items] or [1]) or 1
    rows = "".join(
        f"<div class='bar' data-tip='{esc(labels.get(n, n))}: {v * 100:.1f} %'><span class='bl'>{esc(labels.get(n, n))}</span>"
        f"<span class='bt'><b style='width:{v / mx * 100:.1f}%'></b></span><span class='bv'>{v * 100:.0f} %</span></div>"
        for n, v in items)
    return f"<figure class='chart'><figcaption>{esc(title)}</figcaption><div class='bars'>{rows}</div></figure>"


def heat(pair, values, labels, metric):
    a, b = pair["a"], pair["b"]
    va, vb = values[a], values[b]
    idx = 2 if metric == "wr" else 3
    cells = {(c[0], c[1]): c[idx] for c in pair["cells"]}
    vals = list(cells.values())
    if metric == "wr":
        lo, hi = min(vals), max(vals)
    else:
        mx = max(abs(v) for v in vals) or 1
    s = 26
    out = [f"<table class='heat'><caption>{esc(labels[a])} × {esc(labels[b])}</caption><tr><th></th>"]
    out += [f"<th class='hx'>{esc(fmt_v(v))}</th>" for v in vb] + ["</tr>"]
    for i, x in enumerate(va):
        out.append(f"<tr><th class='hy'>{esc(fmt_v(x))}</th>")
        for j, y in enumerate(vb):
            v = cells.get((i, j))
            if v is None:
                out.append("<td></td>")
                continue
            if metric == "wr":
                t = (v - lo) / (hi - lo) if hi > lo else 0.5
                style = f"background:color-mix(in oklab, var(--seq-hi) {t * 100:.0f}%, var(--seq-lo))"
                txt = f"{v * 100:.0f}"
                tip = f"{labels[a]} = {fmt_v(x)}, {labels[b]} = {fmt_v(y)}: win rate {v * 100:.1f} %"
            else:
                t = v / mx
                pole = "var(--div-pos)" if t >= 0 else "var(--div-neg)"
                style = f"background:color-mix(in oklab, {pole} {abs(t) * 100:.0f}%, var(--div-mid))"
                txt = f"{v:+.2f}"
                tip = f"{labels[a]} = {fmt_v(x)}, {labels[b]} = {fmt_v(y)}: средняя сделка {v:+.3f} %"
            dark = (t if metric == "wr" else abs(t)) > 0.55
            out.append(f"<td style='{style}' class='{'inv' if dark else ''}' data-tip='{esc(tip)}'>{txt}</td>")
        out.append("</tr>")
    out.append("</table>")
    return "".join(out)


def fmt_v(v):
    if isinstance(v, float):
        return f"{v:g}"
    return str(v)


def fmt_x(x, name):
    if x is None:
        return "—"
    v = x.get(name)
    return f"{v:.3g}" if isinstance(v, float) else str(v)


def section(strat, S, res):
    space = res["space"][strat]
    labels = {p["name"]: p["label"] for p in space}
    h = [f"<section id='{strat}'><h2>{esc(S['name'])}</h2>"]

    # Вердикт
    h.append("<h3>Проверка вне подбора</h3><p class='muted'>Все 6-месячные отрезки после окон подбора, склеенные подряд: "
             "PAXG — весь период проверок; XAUUSDT — те же наборы на тех же отрезках, с декабря 2025.</p>")
    h.append(f"<div class='tw'><table><tr><th>Набор</th><th>Рынок</th>{M_HEAD}</tr>")
    gate = {}
    for key, lbl in SETS:
        for mk, mlbl in (("test", "PAXG"), ("xau", "XAUUSDT")):
            tr = stitched(S, mk, key)
            m = stats(tr)
            if mk == "xau":
                gate[key] = m
            h.append(f"<tr><td><i class='sw' style='background:{SERIES[key]}'></i>{lbl}</td><td>{mlbl}</td>{fmt_m(m)}</tr>")
    h.append("</table></div>")
    if strat == "wsb":
        verdicts = []
        for key, lbl in SETS[1:]:
            m = gate.get(key)
            ok = m and m["trades"] and m["total"] > 0
            few = " · мало сделок для вывода (&lt; 30)" if m and m["trades"] < 30 else ""
            verdicts.append(f"<li><b>{lbl}:</b> {'переносится — в плюсе на XAUUSDT' if ok else 'НЕ ПЕРЕНОСИТСЯ — на XAUUSDT не в плюсе'}{few}"
                            f" ({m['total']:+.1f} % за {m['trades']} сделок)</li>" if m else f"<li>{lbl}: нет данных</li>")
        h.append(f"<div class='gate'><b>Условие владельца (1 - C):</b> лучший набор WSB должен быть в плюсе на XAUUSDT.<ul>{''.join(verdicts)}</ul></div>")

    keys = [k for k, _ in SETS]
    h.append(legend(keys))
    h.append("<div class='two'>")
    h.append(line_chart(f"{strat}-paxg", [(k, l, stitched(S, "test", k)) for k, l in SETS], "Сумма PnL, % — PAXG, отрезки проверки"))
    h.append(line_chart(f"{strat}-xau", [(k, l, stitched(S, "xau", k)) for k, l in SETS], "Сумма PnL, % — XAUUSDT, отрезки проверки"))
    h.append("</div>")

    # Набор для торговли
    F = S["final"]
    h.append("<h3>Набор для торговли — лучший последнего окна</h3>")
    h.append(f"<p class='muted'>Подобран на {res['windows'][-1]['train'][0]} – {res['windows'][-1]['train'][1]}. "
             "Строка XAUUSDT 11 мес частично лежит внутри периода подбора (рынок другой) — это справка, не проверка.</p>")
    h.append(f"<div class='tw'><table><tr><th>Набор</th>{M_HEAD}</tr>")
    for key, lbl in SETS:
        if key in F:
            h.append(f"<tr><td>{lbl}, XAUUSDT 11 мес</td>{fmt_m(F[key]['xauAll'])}</tr>")
    h.append("</table></div>")
    last = S["windows"][-1]
    h.append("<div class='tw'><table><tr><th>Переменная</th><th>Оригинал</th><th>Optuna</th><th>Сетка</th></tr>")
    for p in space:
        n = p["name"]
        ox = last["optuna"]["x"] if last.get("optuna") else None
        gx = last["grid"]["x"] if last.get("grid") else None
        mark = " class='hl'" if n in S["grid"]["vars"] else ""
        h.append(f"<tr{mark}><td>{esc(p['label'])}</td><td>{esc(fmt_v(p['default']))}</td>"
                 f"<td>{esc(fmt_x(ox, n))}</td><td>{esc(fmt_x(gx, n))}</td></tr>")
    h.append("</table></div><p class='muted'>Выделены переменные сетки. «Стоп после TP» — доля пути до TP: 0 — безубыток "
             "(вход), 1 — стоп на самом TP. Лимит времени работает, только если «включён» = 1.</p>")
    if F.get("optuna"):
        h.append("<details><summary>Параметры движка (JSON) для переноса в расширение</summary><pre>"
                 + esc(json.dumps({k: F[k]['engine'] for k in ('optuna', 'grid') if k in F}, ensure_ascii=False, indent=1))
                 + "</pre></details>")

    # Важность
    imp_wr = S["importanceMean"]
    imp_ex = {}
    for W in S["windows"]:
        for n, v in W["importance"]["expectancy"].items():
            imp_ex[n] = imp_ex.get(n, 0) + v / len(S["windows"])
    h.append("<h3>Что двигает результат</h3><p class='muted'>fANOVA по прогонам Optuna: доля разброса результата, "
             "которую объясняет переменная; среднее по окнам.</p><div class='two'>")
    h.append(bars(imp_wr, labels, "Важность для win rate"))
    h.append(bars(imp_ex, labels, "Важность для средней сделки"))
    h.append("</div>")

    # Карты пар
    G = S["grid"]
    h.append(f"<h3>Как переменные влияют друг на друга</h3><p class='muted'>Сетка {len(G['vars'])} переменных, "
             f"{G['points']} точек на окно; клетка — среднее по остальным переменным сетки и всем окнам "
             "(на 2 годах подбора). Остальные переменные — лучший набор Optuna своего окна.</p>")
    h.append("<h4>Win rate, %</h4><div class='heats'>")
    h += [heat(p, G["values"], labels, "wr") for p in G["pairs"]]
    h.append("</div><h4>Средняя сделка, % (синий — плюс, красный — минус)</h4><div class='heats'>")
    h += [heat(p, G["values"], labels, "ex") for p in G["pairs"]]
    h.append("</div>")

    # По окнам
    h.append("<h3>По окнам</h3><div class='tw'><table><tr><th>Окно</th><th>Подбор</th><th>Проверка</th>"
             "<th>Допустимых Optuna</th><th>Допустимых сетки</th>"
             + "".join(f"<th>{l}: WR / сумма</th>" for _, l in SETS) + "<th>Сдвиг набора</th></tr>")
    stab = S["stability"]["optuna"]
    for i, (W, win) in enumerate(zip(S["windows"], res["windows"])):
        cells = []
        for key, _ in SETS:
            t = W["test"].get(key)
            if t and t["m"]["trades"]:
                m = t["m"]
                cells.append(f"<td>{m['winRate'] * 100:.0f} % / <span class='{'pos' if m['total'] > 0 else 'neg'}'>{m['total']:+.1f} %</span></td>")
            else:
                cells.append("<td>—</td>")
        sh = stab[i - 1] if i > 0 and stab[i - 1] is not None else None
        h.append(f"<tr><td>{W['k']}</td><td>{win['train'][0]} – {win['train'][1]}</td><td>{win['test'][0]} – {win['test'][1]}</td>"
                 f"<td>{W['feasible']} / {res['config']['trials']}</td><td>{W.get('gridFeasible', 0)} / {S['grid']['points']}</td>"
                 + "".join(cells) + f"<td>{'—' if sh is None else f'{sh:.2f}'}</td></tr>")
    h.append("</table></div><p class='muted'>Допустимый набор: средняя сделка &gt; 0 и ≥ "
             f"{res['config']['minTrades']} сделок за 2 года подбора. Сдвиг набора — среднее расстояние между лучшими "
             "наборами Optuna соседних окон (0 — тот же набор, 1 — противоположный край диапазонов).</p>")
    h.append("</section>")
    return "".join(h), gate


CSS = """
:root{color-scheme:light;--page:#f9f9f7;--surface:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--muted:#898781;
--grid:#e1e0d9;--axis:#c3c2b7;--border:rgba(11,11,11,.10);--s1:#2a78d6;--s2:#eb6834;--s-orig:#898781;
--seq-lo:#e8f0fb;--seq-hi:#184f95;--div-pos:#2a78d6;--div-neg:#e34948;--div-mid:#f0efec;--good:#006300;--bad:#d03b3b}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--page:#0d0d0d;--surface:#1a1a19;
--ink:#f0efec;--ink2:#c3c2b7;--grid:#2c2c2a;--axis:#383835;--border:rgba(255,255,255,.10);--s1:#3987e5;--s2:#d95926;
--seq-lo:#24303f;--seq-hi:#86b6ef;--div-pos:#3987e5;--div-neg:#e66767;--div-mid:#383835;--good:#0ca30c;--bad:#e66767}}
:root[data-theme="dark"]{color-scheme:dark;--page:#0d0d0d;--surface:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--grid:#2c2c2a;
--axis:#383835;--border:rgba(255,255,255,.10);--s1:#3987e5;--s2:#d95926;--seq-lo:#24303f;--seq-hi:#86b6ef;
--div-pos:#3987e5;--div-neg:#e66767;--div-mid:#383835;--good:#0ca30c;--bad:#e66767}
*{box-sizing:border-box}body{margin:0;background:var(--page);color:var(--ink);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1180px;margin:0 auto;padding:24px 16px 64px}h1{font-size:24px;margin:0 0 4px}h2{font-size:20px;margin:40px 0 8px;
padding-top:16px;border-top:1px solid var(--grid)}h3{font-size:16px;margin:28px 0 6px}h4{font-size:14px;margin:16px 0 6px;color:var(--ink2)}
.muted{color:var(--ink2);margin:4px 0 10px}nav a{color:var(--s1);margin-right:16px}
.tw{overflow-x:auto}table{border-collapse:collapse;background:var(--surface);font-variant-numeric:tabular-nums}
th,td{padding:5px 10px;border-bottom:1px solid var(--grid);text-align:left;white-space:nowrap}th{color:var(--ink2);font-weight:600}
td.pos,.pos{color:var(--good)}td.neg,.neg{color:var(--bad)}tr.hl td:first-child{font-weight:600}
.sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:baseline}
.gate{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px 14px;margin:12px 0}.gate ul{margin:6px 0 0;padding-left:20px}
.legend{display:flex;gap:18px;margin:14px 0 4px;color:var(--ink2)}.legend i{display:inline-block;width:14px;height:3px;border-radius:2px;margin-right:6px;vertical-align:middle}
.two{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,520px),1fr));gap:16px}
.chart{margin:0;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px 12px}
figcaption{font-weight:600;margin-bottom:6px}.plot{position:relative}svg{width:100%;height:auto;display:block}
.grid{stroke:var(--grid);stroke-width:1}.base{stroke:var(--axis);stroke-width:1}.tick{fill:var(--muted);font-size:11px}
.dl{fill:var(--ink2);font-size:11px}.xhair{stroke:var(--axis);stroke-width:1;visibility:hidden}
.tip{position:absolute;pointer-events:none;background:var(--surface);color:var(--ink);border:1px solid var(--border);border-radius:6px;
padding:6px 8px;font-size:12px;box-shadow:0 2px 8px rgba(0,0,0,.15);display:none;white-space:nowrap;z-index:5}
.bars{display:grid;gap:4px}.bar{display:grid;grid-template-columns:minmax(120px,240px) 1fr 44px;gap:8px;align-items:center}
.bl{color:var(--ink2);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bt{height:12px}
.bt b{display:block;height:100%;background:var(--s1);border-radius:0 4px 4px 0;min-width:1px}.bv{font-size:12px;text-align:right;font-variant-numeric:tabular-nums}
.heats{display:flex;flex-wrap:wrap;gap:18px;align-items:flex-start}.heat{background:none}.heat caption{font-size:12px;color:var(--ink2);text-align:left;padding-bottom:4px;max-width:260px;white-space:normal}
.heat td{width:42px;height:26px;text-align:center;font-size:11px;padding:0;border:2px solid var(--page);border-radius:4px}
.heat td.inv{color:#fff}.heat th{font-size:10px;font-weight:400;color:var(--muted);padding:0 4px;border:0}
details{margin:8px 0}pre{background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:10px;overflow-x:auto;font-size:12px}
#gtip{position:fixed}
"""

JS = """
const gt=document.getElementById('gtip');
document.addEventListener('mousemove',e=>{const c=e.target.closest('[data-tip]');
 if(!c){gt.style.display='none';return}gt.textContent=c.dataset.tip;gt.style.display='block';
 gt.style.left=Math.min(e.clientX+12,innerWidth-gt.offsetWidth-8)+'px';gt.style.top=(e.clientY+14)+'px'});
const day=s=>new Date(s*1000).toISOString().slice(0,10);
document.querySelectorAll('[data-line]').forEach(pl=>{const m=JSON.parse(pl.dataset.line),svg=pl.querySelector('svg'),
 xh=svg.querySelector('.xhair'),tip=pl.querySelector('.tip');
 pl.addEventListener('mousemove',e=>{const r=svg.getBoundingClientRect(),k=m.W/r.width,px=(e.clientX-r.left)*k;
  if(px<m.L||px>m.W-m.R){tip.style.display='none';xh.style.visibility='hidden';return}
  const x=m.x0+(px-m.L)/(m.W-m.L-m.R)*(m.x1-m.x0);xh.setAttribute('x1',px);xh.setAttribute('x2',px);xh.style.visibility='visible';
  let rows=m.series.map(s=>{let v=0;for(const p of s.p){if(p[0]<=x)v=p[1];else break}
   return `<div><span class="sw" style="background:${s.color}"></span>${s.label}: <b>${v>=0?'+':''}${v.toFixed(1)} %</b></div>`}).join('');
  tip.innerHTML=`<div>${day(x)}</div>`+rows;tip.style.display='block';
  const left=(e.clientX-r.left)+14;tip.style.left=Math.min(left,r.width-tip.offsetWidth-4)+'px';tip.style.top='8px'});
 pl.addEventListener('mouseleave',()=>{tip.style.display='none';xh.style.visibility='hidden'})});
"""


def main():
    with open(os.path.join(OUT, "results.json"), encoding="utf-8") as f:
        res = json.load(f)
    chk = {}
    if os.path.exists(os.path.join(OUT, "check.json")):
        with open(os.path.join(OUT, "check.json"), encoding="utf-8") as f:
            chk = json.load(f)
    body, gates = [], {}
    for strat, S in res["strategies"].items():
        s, gates[strat] = section(strat, S, res)
        body.append(s)

    c = res["config"]
    meta = res["meta"]
    head = [f"<h1>XAUG lab — перебор параметров</h1><p class='muted'>Построен {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')} UTC · "
            f"{len(res['windows'])} окон (подбор {c['trainMonths']} мес → проверка {c['testMonths']} мес) · Optuna {c['trials']} прогонов "
            f"на окно · сетка {c['top']}×{c['grid']} · всего {res['calls']} прогонов за {res['elapsedSec'] / 60:.0f} мин на {c['workers']} потоках</p>",
            "<nav><a href='#wsb'>WSB A</a><a href='#mr'>Разворот B</a><a href='#data'>Данные и сверка</a></nav>",
            "<h3>Как читать</h3><p class='muted'>Подбор видит только 2 года; результат честно оценивается на следующих 6 месяцах, "
            "которых подбор не видел, затем окно сдвигается на 6 месяцев. Лучший набор: средняя сделка &gt; 0, ≥ "
            f"{c['minTrades']} сделок за 2 года, дальше по приоритету win rate (до 1 п.п.) → RR (до 0,05) → число сделок. "
            "PnL сделки — сумма долей × ход цены минус комиссия 0,04 %; сумма — простая, без реинвестирования.</p>"]

    # Данные и сверка
    d = ["<section id='data'><h2>Данные и сверка</h2><div class='tw'><table><tr><th>Рынок</th><th>Свечей</th><th>С</th><th>По</th><th>Дыр &gt; 1 ч</th></tr>"]
    for sym, m in meta.items():
        d.append(f"<tr><td>{sym}</td><td>{m['n']}</td><td>{day(m['first'])}</td><td>{day(m['last'])}</td><td>{len(m['gaps'])}</td></tr>")
    d.append("</table></div>")
    gaps = meta["PAXGUSDT"]["gaps"]
    if gaps:
        d.append("<details><summary>Дыры PAXGUSDT</summary><ul>" + "".join(
            f"<li>{datetime.fromtimestamp(g['from'], timezone.utc):%Y-%m-%d %H:%M} – {datetime.fromtimestamp(g['to'], timezone.utc):%H:%M}: {g['hours']} ч</li>"
            for g in gaps) + "</ul></details>")
    if chk:
        d.append("<h3>Сверка движка с оригиналом (core.js)</h3><div class='tw'><table><tr><th>Набор</th><th>Стратегия</th><th>Меток core.js</th><th>Меток движка</th><th>Итог</th></tr>")
        for r in chk["parity"]:
            d.append(f"<tr><td>{esc(r['set'])}</td><td>{r['strat']}</td><td>{r['core']}</td><td>{r['engine']}</td>"
                     f"<td class='{'pos' if r['same'] else 'neg'}'>{'100 %' if r['same'] else 'расхождение'}</td></tr>")
        d.append("</table></div><h3>Скорость</h3><ul>" + "".join(
            f"<li>{r['strat']}: {r['candles']} свечей за {r['sec']:.2f} с, один поток</li>" for r in chk["speed"]) + "</ul>")
        d.append(f"<h3>Перенос PAXG → XAUUSDT, исходные параметры</h3><div class='tw'><table><tr><th>Стратегия</th><th>Рынок</th>{M_HEAD}<th>Совпало входов</th></tr>")
        for r in chk["transfer"]:
            for sym, k in (("PAXG", "paxg"), ("XAUUSDT", "xau")):
                d.append(f"<tr><td>{r['strat']}</td><td>{sym}</td>{fmt_m(r[k])}<td>{r['matched']} ({r['matched'] / max(1, r[k]['trades']) * 100:.0f} %)</td></tr>")
        d.append("</table></div>")
    d.append("</section>")

    page = ("<!doctype html><html lang='ru'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
            f"<title>XAUG lab</title><style>{CSS}</style></head><body><main>{''.join(head)}{''.join(body)}{''.join(d)}</main>"
            f"<div id='gtip' class='tip'></div><script>{JS}</script></body></html>")
    with open(os.path.join(HERE, "report.html"), "w", encoding="utf-8") as f:
        f.write(page)
    print("lab/report.html готов")
    for strat, g in gates.items():
        for k, m in g.items():
            print(f"{strat} {k} XAUUSDT: сделок {m['trades']}, WR {m['winRate'] * 100:.1f} %, сумма {m['total']:+.1f} %")


if __name__ == "__main__":
    main()
