// Движок lab: обе стратегии из XAUG-v2/src/core.js с параметрами на входе.
// Арифметика и порядок проверок — как в core.js (сверка: lab/check.mjs, ворота 100 %).
// Сделка: доли закрываются на TP1/TP2/TP3, стоп переезжает после TP1/TP2,
// PnL сделки = Σ доля × ход цены, % − комиссия 0,04 % (один раз на сделку).

export const FEE = 0.04;

export const DEFAULTS = {
  wsb: {
    atrPeriod: 14, wickPct: 45, wickRatio: 1.5, minRangeAtr: 0.3,
    boxWin: 5, minWicks: 3, boxEdge: "body", confirm: 1, boxLife: 100,
    slAtr: 1.5, tp1: 0.5, tp2: 0.75, tp3: 1.0, f1: 50, f2: 25,
    be1: 0.04, be2: 0.5, timeLimit: 150,
  },
  mr: {
    bbP: 16, bbSd: 3.9, vwapDev: 1.5, aoFast: 4, aoSlow: 96,
    smiFast: 4, smiSlow: 24, smiSig: 4, uoMult: 1, uoLow: 40,
    lrsLen: 7, lrsThr: 3, armWin: 12, turnsNeed: 3,
    slLong: 1.0, slShort: 0.75, tp1: 0.5, tp2: 0.75, tp3: 1.0, f1: 50, f2: 25,
    be1: 0.04, be2: 0.5, timeLimit: 0, // 0 = без лимита
  },
};

// 1 ± x % без лишнего ulp: 1 + 0.5/100 даёт ровно тот же double, что литерал 1.005.
const up = (pct) => +(1 + pct / 100).toFixed(10);
const dn = (pct) => +(1 - pct / 100).toFixed(10);

function isDeathZone(t) {
  const d = new Date(t * 1000 + 3 * 3600 * 1000);
  const day = d.getUTCDay();
  const hour = d.getUTCHours();
  return (day === 5 && hour >= 12) || day === 6 || day === 0 || (day === 1 && hour < 12);
}

// rows: [[timeSec, o, h, l, c, volume, takerBuy], ...]
export function makeDataset(rows) {
  const n = rows.length;
  const ds = {
    n, t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n),
    l: new Float64Array(n), c: new Float64Array(n), v: new Float64Array(n),
    day: new Int32Array(n), dead: new Uint8Array(n),
  };
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    ds.t[i] = r[0]; ds.o[i] = r[1]; ds.h[i] = r[2]; ds.l[i] = r[3]; ds.c[i] = r[4]; ds.v[i] = r[5];
    const d = new Date(r[0] * 1000);
    ds.day[i] = d.getUTCFullYear() * 1000 + (d.getUTCMonth() + 1) * 50 + d.getUTCDate();
    ds.dead[i] = isDeathZone(r[0]) ? 1 : 0;
  }
  return ds;
}

export function indexAt(ds, timeSec) {
  let lo = 0, hi = ds.n;
  while (lo < hi) { const m = (lo + hi) >> 1; if (ds.t[m] < timeSec) lo = m + 1; else hi = m; }
  return lo;
}

// ─── Сопровождение сделки ────────────────────────────────────────────
// cascade=false — WSB (внутри свечи после TP проверяются только следующие TP),
// cascade=true — Разворот (после TP на той же свече проверяется и новый стоп).
function makePos(dir, entry, sl, p) {
  const L = dir === 1;
  return {
    dir, entry, sl, stage: 0, left: 1, realized: 0, held: 0,
    tp: [L ? entry * up(p.tp1) : entry * dn(p.tp1), L ? entry * up(p.tp2) : entry * dn(p.tp2), L ? entry * up(p.tp3) : entry * dn(p.tp3)],
    stops: [L ? entry * up(p.be1) : entry * dn(p.be1), L ? entry * up(p.be2) : entry * dn(p.be2)],
    frac: [p.f1 / 100, p.f2 / 100, (100 - p.f1 - p.f2) / 100],
  };
}

const move = (pos, price) => ((pos.dir === 1 ? price - pos.entry : pos.entry - price) / pos.entry) * 100;
const KIND_STOP = ["SL", "BE", "P50"];

// Возвращает true, если позиция закрыта целиком на этой свече.
function stopHit(pos, h, l) { return pos.dir === 1 ? l <= pos.sl : h >= pos.sl; }
function tpHit(pos, h, l) { const x = pos.tp[pos.stage]; return pos.dir === 1 ? h >= x : l <= x; }

function closeStop(pos, ev, t) {
  pos.realized += pos.left * move(pos, pos.sl);
  pos.left = 0;
  if (ev) ev.push({ t, kind: KIND_STOP[pos.stage], pnl: pos.stage === 0 ? move(pos, pos.sl) - FEE : null });
}

function takeTp(pos, ev, t) {
  const k = pos.stage;
  const f = Math.min(pos.frac[k], pos.left);
  pos.realized += f * move(pos, pos.tp[k]);
  pos.left = +(pos.left - f).toFixed(10);
  if (ev) ev.push({ t, kind: `TP${k + 1}` });
  if (k < 2) pos.sl = pos.stops[k];
  pos.stage = k + 1;
  return pos.left <= 0 || pos.stage > 2;
}

function stepWsb(pos, h, l, ev, t) {
  if (stopHit(pos, h, l)) { closeStop(pos, ev, t); return true; }
  while (pos.stage <= 2 && tpHit(pos, h, l)) { if (takeTp(pos, ev, t)) return true; }
  return false;
}

function stepMr(pos, h, l, ev, t) {
  for (let s = 0; s <= 2; s++) {
    if (pos.stage !== s) continue;
    if (stopHit(pos, h, l)) { closeStop(pos, ev, t); return true; }
    if (tpHit(pos, h, l) && takeTp(pos, ev, t)) return true;
  }
  return false;
}

function finish(trades, pos, entryIdx, exitIdx) {
  trades.push({ entryIdx, exitIdx, dir: pos.dir, pnl: pos.realized - FEE });
}

// ─── WSB ──────────────────────────────────────────────────────────────
// [i0, i1) — расчётный срез (с прогревом); сделки берутся с входом в [e0, e1).
export function runWsb(ds, p, i0, i1, e0 = i0, e1 = i1, ev = null) {
  const n = i1 - i0;
  const trades = [];
  if (n < 30) return trades;
  const { o, h, l, c, t, dead } = ds;
  const atr = new Float64Array(n);
  const wick = new Int8Array(n); // 1 бычья, -1 медвежья
  const per = p.atrPeriod;
  const wp = p.wickPct / 100, wr = p.wickRatio, mra = p.minRangeAtr;
  const trs = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const i = i0 + k;
    if (k === 0) { trs[k] = h[i] - l[i]; atr[k] = trs[k]; }
    else {
      const hl = h[i] - l[i], hc = Math.abs(h[i] - c[i - 1]), lc = Math.abs(l[i] - c[i - 1]);
      trs[k] = Math.max(hl, hc, lc);
      if (k < per) {
        // как в core.js: среднее TR с начала, сумма заново — тот же порядок сложения
        let sum = 0;
        for (let j = 0; j <= k; j++) sum += trs[j];
        atr[k] = sum / (k + 1);
      } else atr[k] = (atr[k - 1] * (per - 1) + trs[k]) / per;
    }
    const range = h[i] - l[i];
    if (range <= 0) continue;
    const body = Math.abs(c[i] - o[i]);
    const upW = h[i] - Math.max(o[i], c[i]);
    const loW = Math.min(o[i], c[i]) - l[i];
    if (atr[k] && range < mra * atr[k]) continue;
    if (upW >= wp * range && upW >= wr * Math.max(body, loW)) wick[k] = -1;
    else if (loW >= wp * range && loW >= wr * Math.max(body, upW)) wick[k] = 1;
  }

  const W = p.boxWin, need = Math.min(p.minWicks, W), wickEdge = p.boxEdge === "wick";
  let box = null;
  const entries = [];
  for (let k = Math.max(5, W - 1); k < n; k++) {
    const i = i0 + k;
    if (box) {
      box.age++;
      const out = c[i] > box.top ? 1 : c[i] < box.bottom ? -1 : 0;
      if (out !== 0) {
        box.cnt = box.pend === out ? box.cnt + 1 : 1;
        box.pend = out;
      } else box.cnt = 0;
      if (out !== 0 && box.cnt >= p.confirm) {
        if (!dead[i]) entries.push({ k, dir: out, top: box.top, bottom: box.bottom });
        if (k < n - 1) box = null;
      } else if (box.age >= p.boxLife) box = null;
    }
    if (!box) {
      if (dead[i]) continue;
      let bear = 0, bull = 0, top = -Infinity, bottom = Infinity;
      for (let j = k - W + 1; j <= k; j++) {
        if (wick[j] === -1) bear++;
        if (wick[j] === 1) bull++;
        const ii = i0 + j;
        const hi = wickEdge ? h[ii] : Math.max(o[ii], c[ii]);
        const lo = wickEdge ? l[ii] : Math.min(o[ii], c[ii]);
        if (hi > top) top = hi;
        if (lo < bottom) bottom = lo;
      }
      if (bear >= need || bull >= need) box = { top, bottom, age: 0, pend: 0, cnt: 0 };
    }
  }

  const limit = p.timeLimit > 0 ? p.timeLimit : Infinity;
  for (const e of entries) {
    const ei = i0 + e.k;
    if (ei < e0 || ei >= e1) continue;
    const entry = c[ei];
    const a = atr[e.k] || 5.0;
    if (ev) ev.push({ t: t[ei], kind: e.dir === 1 ? "LONG" : "SHORT" });
    if (e.k >= n - 1) continue;
    const riskDist = a * p.slAtr;
    const sl = e.dir === 1 ? Math.min(entry - riskDist, e.bottom) : Math.max(entry + riskDist, e.top);
    const pos = makePos(e.dir, entry, sl, p);
    const end = Math.min(e.k + limit, n);
    let done = false, j = e.k + 1;
    for (; j < end; j++) {
      const ii = i0 + j;
      if (stepWsb(pos, h[ii], l[ii], ev, t[ii])) { done = true; break; }
    }
    if (done) finish(trades, pos, ei, i0 + j);
    else if (e.k + limit <= n) {
      // лимит времени: остаток закрывается по закрытию последней свечи окна
      const xi = i0 + end - 1;
      pos.realized += pos.left * move(pos, c[xi]);
      pos.left = 0;
      finish(trades, pos, ei, xi);
    }
  }
  return trades;
}

// ─── Разворот (Mean Reversion) ────────────────────────────────────────
function ema(src, period) {
  const k = 2 / (period + 1);
  const out = new Float64Array(src.length);
  out[0] = src[0];
  for (let i = 1; i < src.length; i++) out[i] = src[i] * k + out[i - 1] * (1 - k);
  return out;
}

export function mrIndicators(ds, p, i0, i1) {
  const n = i1 - i0;
  const { h, l, c, v, day } = ds;
  const I = {
    vwap: new Float64Array(n), bbU: new Float64Array(n), bbL: new Float64Array(n),
    ao: new Float64Array(n), aoC: new Int8Array(n), tsi: new Float64Array(n), sig: new Float64Array(n),
    uo: new Float64Array(n), lrs: new Float64Array(n),
  };
  let cumPV = 0, cumVol = 0, sess = -1;
  for (let k = 0; k < n; k++) {
    const i = i0 + k;
    if (day[i] !== sess) { sess = day[i]; cumPV = 0; cumVol = 0; }
    const typical = (h[i] + l[i] + c[i]) / 3;
    cumPV += typical * v[i];
    cumVol += v[i];
    I.vwap[k] = cumVol > 0 ? cumPV / cumVol : typical;
  }
  const bbP = p.bbP, bbSd = p.bbSd;
  for (let k = 0; k < n; k++) {
    const i = i0 + k;
    if (k < bbP - 1) { I.bbU[k] = c[i]; I.bbL[k] = c[i]; continue; }
    let sum = 0;
    for (let j = 0; j < bbP; j++) sum += c[i - j];
    const mean = sum / bbP;
    let variance = 0;
    for (let j = 0; j < bbP; j++) variance += Math.pow(c[i - j] - mean, 2);
    const sd = Math.sqrt(variance / bbP);
    I.bbU[k] = mean + bbSd * sd;
    I.bbL[k] = mean - bbSd * sd;
  }
  for (let k = 0; k < n; k++) {
    const i = i0 + k;
    if (k < p.aoSlow) { I.ao[k] = 0; I.aoC[k] = 1; continue; }
    let fs = 0;
    for (let j = 0; j < p.aoFast; j++) fs += (h[i - j] + l[i - j]) / 2;
    let ss = 0;
    for (let j = 0; j < p.aoSlow; j++) ss += (h[i - j] + l[i - j]) / 2;
    const ao = fs / p.aoFast - ss / p.aoSlow;
    I.ao[k] = ao;
    I.aoC[k] = k > 0 && ao >= I.ao[k - 1] ? 1 : -1;
  }
  const diffs = new Float64Array(n), abs = new Float64Array(n);
  for (let k = 1; k < n; k++) { const d = c[i0 + k] - c[i0 + k - 1]; diffs[k] = d; abs[k] = Math.abs(d); }
  const num2 = ema(ema(diffs, p.smiFast), p.smiSlow);
  const den2 = ema(ema(abs, p.smiFast), p.smiSlow);
  for (let k = 0; k < n; k++) I.tsi[k] = 100 * (num2[k] / (den2[k] === 0 ? 0.0001 : den2[k]));
  I.sig = ema(I.tsi, p.smiSig);
  const p1 = Math.round(12 * p.uoMult), p2 = Math.round(24 * p.uoMult), p3 = Math.round(48 * p.uoMult);
  const avg = (i, per) => {
    let bp = 0, tr = 0;
    for (let j = 0; j < per; j++) {
      const minL = Math.min(l[i - j], c[i - j - 1]);
      const maxH = Math.max(h[i - j], c[i - j - 1]);
      bp += c[i - j] - minL;
      tr += maxH - minL;
    }
    return tr === 0 ? 0 : bp / tr;
  };
  for (let k = 0; k < n; k++) {
    if (k < p3) { I.uo[k] = 50; continue; }
    const i = i0 + k;
    I.uo[k] = 100 * (4 * avg(i, p1) + 2 * avg(i, p2) + avg(i, p3)) / 7;
  }
  const N = p.lrsLen, xMean = (N - 1) / 2;
  let xVar = 0;
  for (let j = 0; j < N; j++) xVar += (j - xMean) * (j - xMean);
  for (let k = 0; k < n; k++) {
    if (k < N) { I.lrs[k] = 0; continue; }
    const i = i0 + k;
    let ySum = 0;
    for (let j = 0; j < N; j++) ySum += c[i - (N - 1 - j)];
    const yMean = ySum / N;
    let cov = 0;
    for (let j = 0; j < N; j++) cov += (j - xMean) * (c[i - (N - 1 - j)] - yMean);
    I.lrs[k] = cov / xVar;
  }
  return I;
}

export function runMr(ds, p, i0, i1, e0 = i0, e1 = i1, ev = null) {
  const n = i1 - i0;
  const trades = [];
  if (n < 50) return trades;
  const I = mrIndicators(ds, p, i0, i1);
  const { h, l, c, t, dead } = ds;
  const lo = dn(p.vwapDev), hi = up(p.vwapDev);
  const uoLo = p.uoLow, uoHi = 100 - p.uoLow, thr = p.lrsThr;
  // последний индекс, где условие «взвода» выполнялось
  let lastL = -1e9, lastS = -1e9;
  const limit = p.timeLimit > 0 ? p.timeLimit : Infinity;
  let pos = null, posIdx = -1;
  for (let k = 0; k < n; k++) {
    if (I.bbL[k] <= I.vwap[k] * lo && I.tsi[k] < 0 && I.ao[k] < 0 && I.uo[k] < uoLo && I.lrs[k] < -thr) lastL = k;
    if (I.bbU[k] >= I.vwap[k] * hi && I.tsi[k] > 0 && I.ao[k] > 0 && I.uo[k] > uoHi && I.lrs[k] > thr) lastS = k;
    if (k < 25) continue;
    const i = i0 + k;
    if (pos !== null) {
      pos.held++;
      let closed = stepMr(pos, h[i], l[i], posIdx >= e0 && posIdx < e1 ? ev : null, t[i]);
      if (!closed && pos.held >= limit) {
        pos.realized += pos.left * move(pos, c[i]);
        pos.left = 0;
        closed = true;
      }
      if (closed) {
        if (posIdx >= e0 && posIdx < e1) finish(trades, pos, posIdx, i);
        pos = null;
      }
    }
    if (pos !== null) continue;
    const longArmed = k - lastL < p.armWin;
    const shortArmed = k - lastS < p.armWin;
    if (!longArmed && !shortArmed) continue;
    const q = k - 1;
    const lt = (I.aoC[k] === 1 && I.aoC[q] === -1 ? 1 : 0) + (I.tsi[k] > I.sig[k] && I.tsi[q] <= I.sig[q] ? 1 : 0)
      + (I.uo[k] > I.uo[q] ? 1 : 0) + (I.lrs[k] > I.lrs[q] ? 1 : 0);
    const st = (I.aoC[k] === -1 && I.aoC[q] === 1 ? 1 : 0) + (I.tsi[k] < I.sig[k] && I.tsi[q] >= I.sig[q] ? 1 : 0)
      + (I.uo[k] < I.uo[q] ? 1 : 0) + (I.lrs[k] < I.lrs[q] ? 1 : 0);
    let dir = 0;
    if (longArmed && lt >= p.turnsNeed) dir = 1;
    else if (shortArmed && st >= p.turnsNeed) dir = -1;
    if (dir === 0 || dead[i]) continue;
    const entry = c[i];
    pos = makePos(dir, entry, dir === 1 ? entry * dn(p.slLong) : entry * up(p.slShort), p);
    posIdx = i;
    if (ev && i >= e0 && i < e1) ev.push({ t: t[i], kind: dir === 1 ? "LONG" : "SHORT" });
  }
  return trades;
}

// ─── Итоги ───────────────────────────────────────────────────────────
export function metrics(trades) {
  const n = trades.length;
  let wins = 0, sumW = 0, sumL = 0, total = 0, peak = 0, dd = 0, eq = 0;
  const byExit = [...trades].sort((a, b) => a.exitIdx - b.exitIdx);
  for (const tr of byExit) {
    total += tr.pnl;
    if (tr.pnl > 0) { wins++; sumW += tr.pnl; } else sumL += tr.pnl;
    eq += tr.pnl;
    if (eq > peak) peak = eq;
    if (peak - eq > dd) dd = peak - eq;
  }
  const losses = n - wins;
  const avgWin = wins ? sumW / wins : 0;
  const avgLoss = losses ? -sumL / losses : 0;
  return {
    trades: n,
    winRate: n ? wins / n : 0,
    rr: avgLoss > 0 ? avgWin / avgLoss : (wins ? 99 : 0),
    avgWin, avgLoss,
    expectancy: n ? total / n : 0,
    total, maxDD: dd,
  };
}

export function run(strat, ds, params, i0, i1, e0, e1, ev) {
  const p = { ...DEFAULTS[strat], ...params };
  return strat === "wsb" ? runWsb(ds, p, i0, i1, e0, e1, ev) : runMr(ds, p, i0, i1, e0, e1, ev);
}
