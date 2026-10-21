import { isDeathZone, calculateBreakoutProbability } from "./core.js";

const byMaxDesc = (a, b) => b.max - a.max;

// Повторяет calculateBreakoutProbability (app.js) по слагаемым. Тест: total === «процент» оригинала.
export function explainBreakout(box, bar, data, barIdx) {
  const wCount = box.wickCount || 3;
  const wicks = wCount >= 5 ? 12 : wCount >= 4 ? 8 : wCount >= 3 ? 5 : 0;

  const isLong = box.breakoutDir === "LONG";
  const dirMatch = (isLong && box.signalDir === "LONG") || (!isLong && box.signalDir === "SHORT") ? 8 : 0;

  const idx = barIdx !== undefined ? barIdx : data.findIndex((d) => d.time === bar.time);
  const fromIdx = Math.max(0, (box.startIdx || idx) - 4);
  const toIdx = Math.min(data.length - 1, idx >= 0 ? idx : data.length - 1);
  let formDelta = 0;
  let formVol = 0;
  for (let k = fromIdx; k <= toIdx; k++) {
    formDelta += (data[k].delta || 0);
    formVol += (data[k].volume || 0);
  }
  const dr = formVol > 0 ? (formDelta / formVol) : 0;
  let delta = 0;
  if (isLong) {
    if (dr > 0.20) delta = 12; else if (dr > 0.10) delta = 8; else if (dr > 0.0) delta = 4;
  } else {
    if (dr < -0.20) delta = 12; else if (dr < -0.10) delta = 8; else if (dr < -0.0) delta = 4;
  }

  let zScore = null;
  let z = 0;
  if (idx > 10) {
    const zStart = Math.max(0, idx - 60);
    let zSum = 0;
    let count = 0;
    for (let k = zStart; k < idx; k++) { zSum += (data[k].delta || 0); count++; }
    const zMean = count > 0 ? zSum / count : 0;
    let zVar = 0;
    for (let k = zStart; k < idx; k++) zVar += Math.pow((data[k].delta || 0) - zMean, 2);
    const zStd = Math.sqrt(count > 0 ? zVar / count : 1.0) || 1.0;
    zScore = ((bar.delta || 0) - zMean) / zStd;
    if (isLong && zScore >= 1.0) z = 6;
    else if (!isLong && zScore <= -1.0) z = 6;
  }

  let vwap = 0;
  if (bar.vwap) {
    if (isLong && bar.close > bar.vwap) vwap = 5;
    if (!isLong && bar.close < bar.vwap) vwap = 5;
  }

  const atr = bar.atr || 5.0;
  const range = bar.high - bar.low;
  const impulse = range >= atr * 0.7 ? 4 : 0;

  const factors = [
    { key: "wicks", max: 12, pts: wicks, value: wCount, steps: [5, 8, 12] },
    { key: "delta", max: 12, pts: delta, value: dr, steps: [4, 8, 12] },
    { key: "dirMatch", max: 8, pts: dirMatch, value: dirMatch ? 1 : 0 },
    { key: "z", max: 6, pts: z, value: zScore },
    { key: "vwap", max: 5, pts: vwap, value: bar.vwap ? bar.close - bar.vwap : null },
    { key: "impulse", max: 4, pts: impulse, value: range / atr },
  ].sort(byMaxDesc);

  const raw = 56 + wicks + dirMatch + delta + z + vwap + impulse;
  return { dir: box.breakoutDir, base: 56, raw, total: Math.min(94, Math.max(68, Math.round(raw))), clamp: [68, 94], factors };
}

// Повторяет calculateMeanReversionProbability.
export function explainMrProb(cur, prev) {
  const aoFlip = cur.aoColor !== prev.aoColor ? 7 : 0;
  const smi = Math.abs(cur.smiTsi) > 20 ? 8 : 0;
  const uo = (cur.uo < 30 || cur.uo > 70) ? 8 : 0;
  const lrs = Math.abs(cur.lrs) > 4.0 ? 6 : 0;
  const factors = [
    { key: "smi", max: 8, pts: smi, value: cur.smiTsi },
    { key: "uo", max: 8, pts: uo, value: cur.uo },
    { key: "aoFlip", max: 7, pts: aoFlip, value: cur.aoColor },
    { key: "lrs", max: 6, pts: lrs, value: cur.lrs },
  ].sort(byMaxDesc);
  const raw = 65 + aoFlip + smi + uo + lrs;
  return { base: 65, raw, total: Math.min(92, Math.max(70, Math.round(raw))), clamp: [70, 92], factors };
}

// Условия взвода (updateTradeMarkers, ветка Mean Reversion); порядок — по весу шкалы готовности.
const ARM = [
  { key: "bb", w: 25, long: (b) => b.bbLower <= b.vwapL2, short: (b) => b.bbUpper >= b.vwapU2 },
  { key: "uo", w: 25, long: (b) => b.uo < 40, short: (b) => b.uo > 60 },
  { key: "lrs", w: 20, long: (b) => b.lrs < -3.0, short: (b) => b.lrs > 3.0 },
  { key: "smi", w: 15, long: (b) => b.smiTsi < 0, short: (b) => b.smiTsi > 0 },
  { key: "ao", w: 15, long: (b) => b.ao < 0, short: (b) => b.ao > 0 },
];

export function mrBarState(data, i) {
  const cur = data[i];
  const prev = data[i - 1];
  const arm = { long: ARM.map((c) => c.long(cur)), short: ARM.map((c) => c.short(cur)) };
  const win = { long: [], short: [] };
  for (let k = 11; k >= 0; k--) {
    const b = data[i - k];
    win.long.push(!!b && ARM.every((c) => c.long(b)));
    win.short.push(!!b && ARM.every((c) => c.short(b)));
  }
  const turns = prev
    ? {
        long: [cur.aoColor === 1 && prev.aoColor === -1, cur.smiTsi > cur.smiSig && prev.smiTsi <= prev.smiSig, cur.uo > prev.uo, cur.lrs > prev.lrs],
        short: [cur.aoColor === -1 && prev.aoColor === 1, cur.smiTsi < cur.smiSig && prev.smiTsi >= prev.smiSig, cur.uo < prev.uo, cur.lrs < prev.lrs],
      }
    : { long: [false, false, false, false], short: [false, false, false, false] };
  const longArmed = win.long.some(Boolean);
  const shortArmed = win.short.some(Boolean);
  const longTrigger = turns.long.filter(Boolean).length >= 3;
  const shortTrigger = turns.short.filter(Boolean).length >= 3;
  const dead = isDeathZone(cur.time);
  let entry = null;
  if (i >= 25) {
    if (longArmed && longTrigger) entry = dead ? null : "LONG";
    else if (shortArmed && shortTrigger) entry = dead ? null : "SHORT";
  }
  const sum = (flags) => ARM.reduce((a, c, k) => a + (flags[k] ? c.w : 0), 0);
  return {
    arm, keys: ARM.map((c) => c.key), weights: ARM.map((c) => c.w),
    readyLong: sum(arm.long), readyShort: sum(arm.short),
    win, turns, longArmed, shortArmed, longTrigger, shortTrigger, dead, entry,
  };
}

// Сигналы WSB — тот же отбор, что в начале updateTradeMarkers (ветка wsb).
export function wsbSignals(data, wsb) {
  if (!wsb) return [];
  const boxes = [...(wsb.allBoxes || [])];
  if (wsb.activeBox && wsb.activeBox.breakoutOccurred && !boxes.some((b) => b.startTime === wsb.activeBox.startTime)) {
    boxes.push(wsb.activeBox);
  }
  const seen = new Set();
  const out = [];
  for (const box of boxes) {
    if (!box.breakoutOccurred || !box.breakoutBar) continue;
    const bar = box.breakoutBar;
    if (isDeathZone(bar.time)) continue;
    const k = `${bar.time}_${box.breakoutDir}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const prob = box.probability || calculateBreakoutProbability(box, bar, data);
    out.push({
      strategy: "wsb", idx: data.findIndex((d) => d.time === bar.time), time: bar.time,
      dir: box.breakoutDir, entry: bar.close, prob, box, explain: explainBreakout(box, bar, data, box.endIdx),
    });
  }
  return out.sort((a, b) => a.time - b.time);
}

// Сигналы Разворота берём из стрелок оригинала (точны по построению), раскладку — из правил.
export function mrSignals(data, markers) {
  const idxOf = new Map(data.map((d, i) => [d.time, i]));
  return markers
    .filter((m) => m.shape === "arrowUp" || m.shape === "arrowDown")
    .map((m) => {
      const idx = idxOf.get(m.time);
      return {
        strategy: "mr", idx, time: m.time, dir: m.shape === "arrowUp" ? "LONG" : "SHORT",
        entry: data[idx].close, prob: parseInt(m.text.split(" ")[1], 10),
        explain: explainMrProb(data[idx], data[idx - 1]),
      };
    });
}

export function tradeLevels(sig) {
  const e = sig.entry;
  const L = sig.dir === "LONG";
  let sl;
  if (sig.strategy === "wsb") {
    const rd = (sig.box.breakoutBar.atr || 5.0) * 1.5;
    sl = L ? Math.min(e - rd, sig.box.bottom) : Math.max(e + rd, sig.box.top);
  } else {
    sl = L ? e * 0.990 : e * 1.0075;
  }
  return {
    entry: e, sl,
    tp1: L ? e * 1.005 : e * 0.995,
    tp2: L ? e * 1.0075 : e * 0.9925,
    tp3: L ? e * 1.010 : e * 0.990,
    be: L ? e * 1.0004 : e * 0.9996,
    p50: L ? e * 1.005 : e * 0.995,
  };
}

const TEXT = {
  TP1: "■ +0.50% (50% TP1)",
  TP2: "■ +0.75% (25% TP2)",
  TP3: "■ +1.00% (25% TP3)",
  BE: "■ [РОЙ: +0.00%] (Б/У Стоп 50%)",
  P50: "■ [РОЙ: +0.50%] (Стоп +0.5% 25%)",
};
const COLOR = { SL: "#f43f5e", BE: "#eab308", TP1: "#10b981", TP2: "#10b981", TP3: "#10b981", P50: "#10b981" };

// Сопровождение сделки — повтор обеих симуляций updateTradeMarkers. WSB: ≤150 свечей, TP-цепочка в одной свече;
// Разворот: без лимита, после TP1 на той же свече проверяется стоп Б/У.
export function tradeState(sig, data) {
  const lv = tradeLevels(sig);
  const L = sig.dir === "LONG";
  const hit = (b, p) => (L ? b.high >= p : b.low <= p);
  const stop = (b, p) => (L ? b.low <= p : b.high >= p);
  const events = [];
  let stage = 0;
  let sl = lv.sl;
  let open = true;
  const ev = (j, kind) => {
    const text = kind === "SL"
      ? `■ [РОЙ: ${(((L ? sl - lv.entry : lv.entry - sl) / lv.entry) * 100 - 0.04).toFixed(2)}%] (Stop Loss)`
      : TEXT[kind];
    events.push({ idx: j, time: data[j].time, kind, text, color: COLOR[kind] });
  };
  const wsb = sig.strategy === "wsb";
  const end = wsb ? Math.min(sig.idx + 150, data.length) : data.length;
  if (sig.idx < 0) return { levels: lv, sl, stage, events, open: false, expired: false };
  for (let j = sig.idx + 1; j < end && open; j++) {
    const b = data[j];
    if (wsb) {
      if (stage === 0) {
        if (stop(b, sl)) { ev(j, "SL"); open = false; }
        else if (hit(b, lv.tp1)) {
          ev(j, "TP1"); sl = lv.be; stage = 1;
          if (hit(b, lv.tp2)) { ev(j, "TP2"); sl = lv.p50; stage = 2; if (hit(b, lv.tp3)) { ev(j, "TP3"); open = false; } }
        }
      } else if (stage === 1) {
        if (stop(b, sl)) { ev(j, "BE"); open = false; }
        else if (hit(b, lv.tp2)) { ev(j, "TP2"); sl = lv.p50; stage = 2; if (hit(b, lv.tp3)) { ev(j, "TP3"); open = false; } }
      } else {
        if (stop(b, sl)) { ev(j, "P50"); open = false; }
        else if (hit(b, lv.tp3)) { ev(j, "TP3"); open = false; }
      }
    } else {
      if (stage === 0) {
        if (stop(b, sl)) { ev(j, "SL"); open = false; continue; }
        if (hit(b, lv.tp1)) { ev(j, "TP1"); sl = lv.be; stage = 1; }
      }
      if (stage === 1) {
        if (stop(b, sl)) { ev(j, "BE"); open = false; continue; }
        if (hit(b, lv.tp2)) { ev(j, "TP2"); sl = lv.p50; stage = 2; }
      }
      if (stage === 2) {
        if (stop(b, sl)) { ev(j, "P50"); open = false; continue; }
        if (hit(b, lv.tp3)) { ev(j, "TP3"); open = false; }
      }
    }
  }
  const expired = open && wsb && end < data.length;
  return { levels: lv, sl, stage, events, open: open && !expired, expired };
}

export function openTrade(signals, data) {
  for (let k = signals.length - 1; k >= 0; k--) {
    const state = tradeState(signals[k], data);
    if (state.open) return { sig: signals[k], state };
  }
  return null;
}
