/**
 * XAUUSDT GOLD STRATEGY TERMINAL — CLIENT APPLICATION
 * ===================================================
 * 1. World Clocks & Market Sessions (Local, London, Beijing, New York)
 * 2. Real-Time Binance Futures REST & WebSocket Live Streaming
 * 3. TradingView Lightweight Charts (Candles + White VWAP + Orange BB 16, 3.9)
 * 4. Indicator Engines (VWAP, BB, AO, SMI Ergodic, UO, LinReg Slope)
 * 5. Dynamic "% to Decision" Calculators
 * 6. Web Audio API Triple-Beep Sound Alert & Bell Control
 */

// --- CONFIGURATION ---
const CONFIG = {
  symbol: "XAUUSDT",
  timeframe: "15m",
  limit: 1000, // 1000 свечей (~10.4 дней) для глубокого анализа и полного прогрева индикаторов
  restUrl: "https://fapi.binance.com/fapi/v1/klines",
  tickerUrl: "https://fapi.binance.com/fapi/v1/ticker/24hr",
  wsUrl: "wss://fstream.binance.com/ws/xauusdt@kline_15m",
  bbPeriod: 16,
  bbStdev: 3.9,
  aoFast: 4,
  aoSlow: 96,
  smiFast: 4,
  smiSlow: 24,
  smiSignal: 4,
  uoP1: 12,
  uoP2: 24,
  uoP3: 48,
  lrsLen: 7,
  vwapSessionHour: 0 // 00:00 UTC
};

// --- APPLICATION STATE ---
let klinesData = [];
let historicalTrades = [];
let chart = null;
let candleSeries = null;
let vwapMidSeries = null;
let vwapUpper1Series = null;
let vwapLower1Series = null;
let vwapUpper2Series = null;
let vwapLower2Series = null;
let bbMidSeries = null;
let bbUpperSeries = null;
let bbLowerSeries = null;

let isVwapVisible = true;
let isBbVisible = true;
let isMarkersVisible = true;
let isAlertEnabled = true;
let isCrosshairHovering = false;
let audioCtx = null;
let ws = null;
let lastSignalTime = null;

// WSB ORDER-FLOW STATE
let activeStrategy = "wsb";
let isWsbBoxVisible = true;
let wsbBoxTopLine = null;
let wsbBoxBottomLine = null;
let wsbCurrentState = null;

// ============================================================
// 1. МИРОВЫЕ ЧАСЫ И БИРЖЕВЫЕ СЕССИИ
// ============================================================

function updateWorldClocks() {
  const now = new Date();

  // 1. Локальное время
  const localTimeStr = now.toLocaleTimeString("ru-RU", { hour12: false });
  const localDateStr = now.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
  document.getElementById("time-local").textContent = localTimeStr;
  document.getElementById("date-local").textContent = localDateStr;

  // 2. Лондон (UTC/BST)
  const londonTimeStr = now.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour12: false });
  document.getElementById("time-london").textContent = londonTimeStr;

  // 3. Китай / Пекин (UTC+8)
  const chinaTimeStr = now.toLocaleTimeString("en-GB", { timeZone: "Asia/Shanghai", hour12: false });
  document.getElementById("time-china").textContent = chinaTimeStr;

  // 4. США / Нью-Йорк (UTC-4 / EDT)
  const usaTimeStr = now.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false });
  document.getElementById("time-usa").textContent = usaTimeStr;

  // Определение активности биржевых сессий (по UTC)
  const utcHours = now.getUTCHours();
  const utcMins = now.getUTCMinutes();
  const utcTotal = utcHours * 60 + utcMins;

  // Лондонская сессия: 08:00 - 16:30 UTC
  const isLondonActive = utcTotal >= (8 * 60) && utcTotal <= (16 * 60 + 30);
  // Азиатская сессия (Пекин/Токио): 00:00 - 09:00 UTC
  const isChinaActive = utcTotal >= 0 && utcTotal <= (9 * 60);
  // Американская сессия (Нью-Йорк): 13:30 - 20:00 UTC
  const isUsaActive = utcTotal >= (13 * 60 + 30) && utcTotal <= (20 * 60);

  toggleSessionBadge("session-london", isLondonActive);
  toggleSessionBadge("session-china", isChinaActive);
  toggleSessionBadge("session-usa", isUsaActive);
}

function toggleSessionBadge(elemId, isActive) {
  const el = document.getElementById(elemId);
  if (!el) return;
  if (isActive) {
    el.classList.add("active-session");
  } else {
    el.classList.remove("active-session");
  }
}

// ============================================================
// 2. ЗВУКОВОЙ СИНТЕЗАТОР (WEB AUDIO API) — ТРОЙНОЙ СИГНАЛ
// ============================================================

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Воспроизведение чистого тройного короткого звука
 * 3 звука: Beep 1 (880Hz, 80ms) -> Beep 2 (1174Hz, 80ms) -> Beep 3 (1760Hz, 120ms)
 */
function playTripleAlertSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const beeps = [
      { freq: 880, start: 0.00, dur: 0.08 },
      { freq: 1174.66, start: 0.12, dur: 0.08 },
      { freq: 1760, start: 0.24, dur: 0.12 }
    ];

    const now = ctx.currentTime;

    beeps.forEach(b => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(b.freq, now + b.start);

      // Плавная огибающая без щелчков
      gain.gain.setValueAtTime(0.0001, now + b.start);
      gain.gain.exponentialRampToValueAtTime(0.3, now + b.start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + b.start + b.dur);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + b.start);
      osc.stop(now + b.start + b.dur + 0.02);
    });
  } catch (err) {
    console.warn("Audio playback error:", err);
  }
}

// ============================================================
// 3. МАТЕМАТИЧЕСКИЕ РАСЧЕТЫ ИНДИКАТОРОВ
// ============================================================

function calculateIndicators(data) {
  if (data.length < 50) return [];

  const results = [];
  let cumPV = 0;
  let cumVol = 0;
  let currentSession = -1;

  // 1. Session VWAP
  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    const date = new Date(d.time * 1000);
    const daySession = date.getUTCFullYear() * 1000 + (date.getUTCMonth() + 1) * 50 + date.getUTCDate();

    if (daySession !== currentSession) {
      currentSession = daySession;
      cumPV = 0;
      cumVol = 0;
    }

    const typical = (d.high + d.low + d.close) / 3;
    cumPV += typical * d.volume;
    cumVol += d.volume;
    const vwap = cumVol > 0 ? cumPV / cumVol : typical;

    d.vwap = vwap;
    d.vwapU1 = vwap * 1.010;
    d.vwapL1 = vwap * 0.990;
    d.vwapU2 = vwap * 1.015;
    d.vwapL2 = vwap * 0.985;
  }

  // 2. Bollinger Bands (16, 3.9)
  const bbP = CONFIG.bbPeriod;
  const bbStd = CONFIG.bbStdev;
  for (let i = 0; i < data.length; i++) {
    if (i < bbP - 1) {
      data[i].bbMid = data[i].close;
      data[i].bbUpper = data[i].close;
      data[i].bbLower = data[i].close;
      continue;
    }
    let sum = 0;
    for (let j = 0; j < bbP; j++) sum += data[i - j].close;
    const mean = sum / bbP;

    let variance = 0;
    for (let j = 0; j < bbP; j++) variance += Math.pow(data[i - j].close - mean, 2);
    const stdev = Math.sqrt(variance / bbP);

    data[i].bbMid = mean;
    data[i].bbUpper = mean + bbStd * stdev;
    data[i].bbLower = mean - bbStd * stdev;
  }

  // 3. Awesome Oscillator (AO: 4, 96)
  for (let i = 0; i < data.length; i++) {
    if (i < CONFIG.aoSlow) {
      data[i].ao = 0;
      data[i].aoColor = 1;
      continue;
    }
    let fastSum = 0;
    for (let j = 0; j < CONFIG.aoFast; j++) fastSum += (data[i - j].high + data[i - j].low) / 2;
    const fastSMA = fastSum / CONFIG.aoFast;

    let slowSum = 0;
    for (let j = 0; j < CONFIG.aoSlow; j++) slowSum += (data[i - j].high + data[i - j].low) / 2;
    const slowSMA = slowSum / CONFIG.aoSlow;

    const ao = fastSMA - slowSMA;
    data[i].ao = ao;
    data[i].aoColor = (i > 0 && ao >= data[i - 1].ao) ? 1 : -1;
  }

  // 4. SMI Ergodic (4, 24, 4)
  function calcEMA(arr, period) {
    const k = 2 / (period + 1);
    const ema = [arr[0]];
    for (let i = 1; i < arr.length; i++) {
      ema.push(arr[i] * k + ema[i - 1] * (1 - k));
    }
    return ema;
  }

  const diffs = [0];
  const absDiffs = [0];
  for (let i = 1; i < data.length; i++) {
    const d = data[i].close - data[i - 1].close;
    diffs.push(d);
    absDiffs.push(Math.abs(d));
  }

  const num1 = calcEMA(diffs, CONFIG.smiFast);
  const num2 = calcEMA(num1, CONFIG.smiSlow);

  const den1 = calcEMA(absDiffs, CONFIG.smiFast);
  const den2 = calcEMA(den1, CONFIG.smiSlow);

  const tsi = [];
  for (let i = 0; i < data.length; i++) {
    const den = den2[i] === 0 ? 0.0001 : den2[i];
    tsi.push(100 * (num2[i] / den));
  }

  const smiSignal = calcEMA(tsi, CONFIG.smiSignal);

  for (let i = 0; i < data.length; i++) {
    data[i].smiTsi = tsi[i];
    data[i].smiSig = smiSignal[i];
    data[i].smiHist = tsi[i] - smiSignal[i];
  }

  // 5. Ultimate Oscillator (UO: 12, 24, 48)
  for (let i = 0; i < data.length; i++) {
    if (i < CONFIG.uoP3) {
      data[i].uo = 50;
      continue;
    }
    function avgBPTR(p) {
      let bpSum = 0;
      let trSum = 0;
      for (let j = 0; j < p; j++) {
        const cur = data[i - j];
        const prev = data[i - j - 1];
        const minL = Math.min(cur.low, prev.close);
        const maxH = Math.max(cur.high, prev.close);
        bpSum += (cur.close - minL);
        trSum += (maxH - minL);
      }
      return trSum === 0 ? 0 : bpSum / trSum;
    }

    const a1 = avgBPTR(CONFIG.uoP1);
    const a2 = avgBPTR(CONFIG.uoP2);
    const a3 = avgBPTR(CONFIG.uoP3);
    data[i].uo = 100 * (4 * a1 + 2 * a2 + a3) / 7;
  }

  // 6. LinReg Slope (7)
  const lrsN = CONFIG.lrsLen;
  const x = [0, 1, 2, 3, 4, 5, 6];
  const xMean = 3;
  const xVar = 28; // sum((x - 3)^2)

  for (let i = 0; i < data.length; i++) {
    if (i < lrsN) {
      data[i].lrs = 0;
      continue;
    }
    let ySum = 0;
    for (let j = 0; j < lrsN; j++) ySum += data[i - (lrsN - 1 - j)].close;
    const yMean = ySum / lrsN;

    let cov = 0;
    for (let j = 0; j < lrsN; j++) {
      const yVal = data[i - (lrsN - 1 - j)].close;
      cov += (x[j] - xMean) * (yVal - yMean);
    }
    data[i].lrs = cov / xVar;
  }

  return data;
}

// ============================================================
// 4. РАСЧЕТ "% ДО УРОВНЯ ПРИНЯТИЯ РЕШЕНИЯ"
// ============================================================

function updateDecisionMetrics(last) {
  if (!last) return;

  // 1. ULTIMATE OSCILLATOR (UO)
  // Пороги: Лонг < 40, Шорт > 60 (или экстремальный 70)
  const uo = last.uo;
  document.getElementById("ind-uo-val").textContent = uo.toFixed(1);

  // Позиция иглы на шкале (0..100)
  const needlePos = Math.max(0, Math.min(100, uo));
  document.getElementById("uo-needle").style.left = `${needlePos}%`;

  let uoCalcText = "";
  if (uo >= 60) {
    const inZoneOver = ((uo - 60) / 40) * 100;
    uoCalcText = `<span class="text-red">В ЗОНЕ SELL! (+${inZoneOver.toFixed(0)}% сверх 60)</span>`;
  } else if (uo <= 40) {
    const inZoneBuy = ((40 - uo) / 40) * 100;
    uoCalcText = `<span class="text-green">В ЗОНЕ BUY! (+${inZoneBuy.toFixed(0)}% ниже 40)</span>`;
  } else {
    // В нейтральной зоне
    const distToSell = 60 - uo;
    const distToBuy = uo - 40;
    const pctToSell = ((distToSell / 20) * 100).toFixed(0);
    const pctToBuy = ((distToBuy / 20) * 100).toFixed(0);
    uoCalcText = `Осталось <b class="text-red">${pctToSell}%</b> до Sell (60) | <b class="text-green">${pctToBuy}%</b> до Buy (40)`;
  }
  document.getElementById("uo-calc-dist").innerHTML = uoCalcText;

  // 2. AWESOME OSCILLATOR (AO)
  document.getElementById("ind-ao-val").textContent = last.ao.toFixed(2);
  const aoBadge = document.getElementById("ind-ao-badge");
  if (last.aoColor === 1) {
    aoBadge.textContent = "РОСТ (ЗЕЛЕНЫЙ)";
    aoBadge.className = "ao-color-badge green";
  } else {
    aoBadge.textContent = "СПАД (КРАСНЫЙ)";
    aoBadge.className = "ao-color-badge red";
  }

  let aoStatus = "";
  if (last.ao < 0) {
    aoStatus = `Отрицательный (${last.ao.toFixed(2)}) • <span class="text-green">Готов для Лонга</span>`;
  } else {
    aoStatus = `Положительный (+${last.ao.toFixed(2)}) • <span class="text-red">Готов для Шорта</span>`;
  }
  document.getElementById("ao-calc-dist").innerHTML = aoStatus;

  // 3. SMI ERGODIC
  document.getElementById("ind-smi-tsi").textContent = last.smiTsi.toFixed(2);
  document.getElementById("ind-smi-sig").textContent = `Sig: ${last.smiSig.toFixed(2)}`;

  const smiDiff = last.smiTsi - last.smiSig;
  let smiText = "";
  if (smiDiff > 0) {
    smiText = `<span class="text-green">Бычий кросс (+${smiDiff.toFixed(2)})</span> • Выше сигнальной`;
  } else {
    smiText = `<span class="text-red">Медвежий кросс (${smiDiff.toFixed(2)})</span> • Ниже сигнальной`;
  }
  document.getElementById("smi-calc-dist").innerHTML = smiText;

  // 4. LINREG SLOPE
  const lrs = last.lrs;
  document.getElementById("ind-lrs-val").textContent = lrs.toFixed(2);

  let lrsText = "";
  if (lrs > 3.0) {
    lrsText = `<span class="text-red">ЭКСТРЕМУМ ШОРТА (|LRS| > 3.0)</span>`;
  } else if (lrs < -3.0) {
    lrsText = `<span class="text-green">ЭКСТРЕМУМ ЛОНГА (|LRS| < -3.0)</span>`;
  } else {
    const toLong = Math.abs(-3.0 - lrs);
    const toShort = Math.abs(3.0 - lrs);
    lrsText = `До порога ±3.0: <b class="text-green">${toLong.toFixed(2)}</b> (Long) / <b class="text-red">${toShort.toFixed(2)}</b> (Short)`;
  }
  document.getElementById("lrs-calc-dist").innerHTML = lrsText;

  // 5. КАСАНИЕ BB И VWAP 1.5%
  const touchBadge = document.getElementById("touch-badge");
  const bbUpGap = last.vwapU2 - last.bbUpper;
  const bbLowGap = last.bbLower - last.vwapL2;

  let touchText = "";
  let isTouching = false;

  if (last.bbUpper >= last.vwapU2) {
    isTouching = true;
    touchBadge.textContent = "В ЗОНЕ ШОРТА";
    touchBadge.className = "touch-state-badge active-touch";
    touchText = `<span class="text-red">BB пробил VWAP +1.5% на $${Math.abs(bbUpGap).toFixed(2)}!</span>`;
  } else if (last.bbLower <= last.vwapL2) {
    isTouching = true;
    touchBadge.textContent = "В ЗОНЕ ЛОНГА";
    touchBadge.className = "touch-state-badge active-touch";
    touchText = `<span class="text-green">BB пробил VWAP -1.5% на $${Math.abs(bbLowGap).toFixed(2)}!</span>`;
  } else {
    touchBadge.textContent = "ВНЕ ЗОНЫ";
    touchBadge.className = "touch-state-badge";
    const gapUpPct = (bbUpGap / last.close) * 100;
    const gapLowPct = (bbLowGap / last.close) * 100;
    touchText = `Осталось до касания: Шорт <b>${gapUpPct.toFixed(2)}%</b> ($${bbUpGap.toFixed(1)}) | Лонг <b>${gapLowPct.toFixed(2)}%</b> ($${bbLowGap.toFixed(1)})`;
  }
  document.getElementById("touch-calc-dist").innerHTML = touchText;

  // 6. СВОДНЫЕ РАДАРЫ ГОТОВНОСТИ (LONG & SHORT READY %)
  // Лонг условия (5 пунктов):
  // 1. BB Lower <= VWAP L2
  // 2. UO < 40
  // 3. SMI < 0
  // 4. AO < 0
  // 5. LRS < -3.0
  let longPoints = 0;
  if (last.bbLower <= last.vwapL2) longPoints += 25;
  if (last.uo < 40) longPoints += 25;
  if (last.smiTsi < 0) longPoints += 15;
  if (last.ao < 0) longPoints += 15;
  if (last.lrs < -3.0) longPoints += 20;

  // Шорт условия (5 пунктов):
  // 1. BB Upper >= VWAP U2
  // 2. UO > 60
  // 3. SMI > 0
  // 4. AO > 0
  // 5. LRS > 3.0
  let shortPoints = 0;
  if (last.bbUpper >= last.vwapU2) shortPoints += 25;
  if (last.uo > 60) shortPoints += 25;
  if (last.smiTsi > 0) shortPoints += 15;
  if (last.ao > 0) shortPoints += 15;
  if (last.lrs > 3.0) shortPoints += 20;

  document.getElementById("long-readiness-pct").textContent = `${longPoints}%`;
  document.getElementById("long-progress-bar").style.width = `${longPoints}%`;
  document.getElementById("long-readiness-desc").textContent = 
    longPoints >= 100 ? "🔥 ЗОНА ВЗВОДА АКТИВНА! Ожидание разворота в ЛОНГ" : `Выполнено условий: ${Math.round(longPoints/20)}/5`;

  document.getElementById("short-readiness-pct").textContent = `${shortPoints}%`;
  document.getElementById("short-progress-bar").style.width = `${shortPoints}%`;
  document.getElementById("short-readiness-desc").textContent = 
    shortPoints >= 100 ? "🔥 ЗОНА ВЗВОДА АКТИВНА! Ожидание разворота в ШОРТ" : `Выполнено условий: ${Math.round(shortPoints/20)}/5`;

  // Обновление карточки статуса Mean Reversion
  const mrStateText = document.getElementById("mr-state-text");
  const mrSubText = document.getElementById("mr-sub-text");
  if (mrStateText && mrSubText) {
    if (longPoints >= 100) {
      mrStateText.textContent = "ВЗВЕДЕН ЛОНГ";
      mrStateText.className = "status-state text-green";
      mrSubText.textContent = "Экстремум достигнут, ловим разворотный триггер";
    } else if (shortPoints >= 100) {
      mrStateText.textContent = "ВЗВЕДЕН ШОРТ";
      mrStateText.className = "status-state text-red";
      mrSubText.textContent = "Экстремум достигнут, ловим разворотный триггер";
    } else {
      mrStateText.textContent = "МОНИТОРИНГ";
      mrStateText.className = "status-state text-cyan";
      mrSubText.textContent = "Сканирование экстремумов VWAP/BB...";
    }
  }

  // Обновление метрик в футере графика
  document.getElementById("val-vwap-u2").textContent = `$${last.vwapU2.toFixed(2)}`;
  document.getElementById("val-bb-u").textContent = `$${last.bbUpper.toFixed(2)}`;
  document.getElementById("val-vwap-mid").textContent = `$${last.vwap.toFixed(2)}`;
  document.getElementById("val-bb-l").textContent = `$${last.bbLower.toFixed(2)}`;
  document.getElementById("val-vwap-l2").textContent = `$${last.vwapL2.toFixed(2)}`;
}

// ============================================================
// 4-B. WSB ORDER-FLOW МОДУЛЬ РАСЧЕТОВ И ИНТЕРФЕЙСА
// ============================================================

function calculateATR(data, period = 14) {
  if (data.length < period + 1) return;
  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      data[i].tr = data[i].high - data[i].low;
      data[i].atr = data[i].tr;
      continue;
    }
    const hl = data[i].high - data[i].low;
    const hc = Math.abs(data[i].high - data[i - 1].close);
    const lc = Math.abs(data[i].low - data[i - 1].close);
    data[i].tr = Math.max(hl, hc, lc);
    if (i < period) {
      let sum = 0;
      for (let j = 0; j <= i; j++) sum += data[j].tr;
      data[i].atr = sum / (i + 1);
    } else {
      data[i].atr = (data[i - 1].atr * (period - 1) + data[i].tr) / period;
    }
  }
}

/**
 * Фильтр "Зоны смерти" (выходные):
 * Мы не делаем прогнозы в зоне смерти — с 12:00 пятницы до 12:00 понедельника
 * (первые 12 часов после воскресенья) по локальному времени (Киев / МСК, UTC+3).
 */
function isDeathZone(timestampSec, utcOffsetHours = 3) {
  if (!timestampSec) return false;
  const localMs = (timestampSec * 1000) + (utcOffsetHours * 3600 * 1000);
  const d = new Date(localMs);
  const day = d.getUTCDay(); // 0: вс, 1: пн, 5: пт, 6: сб
  const hour = d.getUTCHours();

  if (day === 5 && hour >= 12) return true; // Пятница с 12:00 дня
  if (day === 6) return true;               // Суббота весь день
  if (day === 0) return true;               // Воскресенье весь день
  if (day === 1 && hour < 12) return true;  // Понедельник до 12:00 дня
  return false;
}

function classifyCandleWick(c, atr) {
  const range = c.high - c.low;
  if (range <= 0) return { type: "none", upperPct: 0, lowerPct: 0 };

  const body = Math.abs(c.close - c.open);
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;

  const upperPct = Math.round((upperWick / range) * 100);
  const lowerPct = Math.round((lowerWick / range) * 100);

  // Фильтр мелких свечей (range < 0.3 * ATR)
  if (atr && range < 0.3 * atr) {
    return { type: "none", upperPct, lowerPct };
  }

  // Медвежья тень (отторжение сверху): upperWick >= 45% от свечи и в 1.5 раза больше тела и нижней тени
  if (upperWick >= 0.45 * range && upperWick >= 1.5 * Math.max(body, lowerWick)) {
    return { type: "bear_wick", upperPct, lowerPct };
  }

  // Бычья тень (отторжение снизу): lowerWick >= 45% от свечи и в 1.5 раза больше тела и верхней тени
  if (lowerWick >= 0.45 * range && lowerWick >= 1.5 * Math.max(body, upperWick)) {
    return { type: "bull_wick", upperPct, lowerPct };
  }

  return { type: "none", upperPct, lowerPct };
}

/**
 * Расчет вероятности события (пробоя бокса WSB) в %
 */
function calculateBreakoutProbability(box, bar, data, barIdx) {
  let score = 56;

  // 1. Плотность формации теней (3-5 теней)
  const wCount = box.wickCount || 3;
  if (wCount >= 5) score += 12;
  else if (wCount >= 4) score += 8;
  else if (wCount >= 3) score += 5;

  // 2. Соответствие направления аккумуляции и направления пробоя
  const isLong = box.breakoutDir === "LONG";
  if ((isLong && box.signalDir === "LONG") || (!isLong && box.signalDir === "SHORT")) {
    score += 8;
  }

  // 3. Order-Flow Delta Ratio
  const idx = barIdx !== undefined ? barIdx : data.findIndex(d => d.time === bar.time);
  const fromIdx = Math.max(0, (box.startIdx || idx) - 4);
  const toIdx = Math.min(data.length - 1, idx >= 0 ? idx : data.length - 1);
  let formDelta = 0;
  let formVol = 0;
  for (let k = fromIdx; k <= toIdx; k++) {
    formDelta += (data[k].delta || 0);
    formVol += (data[k].volume || 0);
  }
  const dr = formVol > 0 ? (formDelta / formVol) : 0;

  if (isLong) {
    if (dr > 0.20) score += 12;
    else if (dr > 0.10) score += 8;
    else if (dr > 0.0) score += 4;
  } else {
    if (dr < -0.20) score += 12;
    else if (dr < -0.10) score += 8;
    else if (dr < -0.0) score += 4;
  }

  // 4. Z-Score дельты свечи
  if (idx > 10) {
    const zLookback = 60;
    const zStart = Math.max(0, idx - zLookback);
    let zSum = 0;
    let count = 0;
    for (let k = zStart; k < idx; k++) {
      zSum += (data[k].delta || 0);
      count++;
    }
    const zMean = count > 0 ? zSum / count : 0;
    let zVar = 0;
    for (let k = zStart; k < idx; k++) {
      zVar += Math.pow((data[k].delta || 0) - zMean, 2);
    }
    const zStd = Math.sqrt(count > 0 ? zVar / count : 1.0) || 1.0;
    const zScore = ((bar.delta || 0) - zMean) / zStd;

    if (isLong && zScore >= 1.0) score += 6;
    else if (!isLong && zScore <= -1.0) score += 6;
  }

  // 5. Сессионный VWAP
  if (bar.vwap) {
    if (isLong && bar.close > bar.vwap) score += 5;
    if (!isLong && bar.close < bar.vwap) score += 5;
  }

  // 6. Импульс относительно ATR
  const atr = bar.atr || 5.0;
  if ((bar.high - bar.low) >= atr * 0.7) score += 4;

  return Math.min(94, Math.max(68, Math.round(score)));
}

/**
 * Расчет вероятности для Mean Reversion сигналов в %
 */
function calculateMeanReversionProbability(cur, prev) {
  let score = 65;
  if (cur.aoColor !== prev.aoColor) score += 7;
  if (Math.abs(cur.smiTsi) > 20) score += 8;
  if (cur.uo < 30 || cur.uo > 70) score += 8;
  if (Math.abs(cur.lrs) > 4.0) score += 6;
  return Math.min(92, Math.max(70, Math.round(score)));
}

function calculateWSBOrderFlow(data) {
  if (data.length < 30) return null;

  calculateATR(data, 14);

  // Классификация теней для всех свечей
  for (let i = 0; i < data.length; i++) {
    const wInfo = classifyCandleWick(data[i], data[i].atr);
    data[i].wickType = wInfo.type;
    data[i].upperWickPct = wInfo.upperPct;
    data[i].lowerWickPct = wInfo.lowerPct;
  }

  // Поиск активного бокса и накопление всех боксов
  let activeBox = null;
  const allBoxes = [];
  const boxTimeout = 100;

  for (let i = 5; i < data.length; i++) {
    if (activeBox) {
      activeBox.age++;
      const bar = data[i];

      if (bar.close > activeBox.top) {
        if (!isDeathZone(bar.time)) {
          activeBox.breakoutOccurred = true;
          activeBox.breakoutBar = bar;
          activeBox.breakoutDir = "LONG";
          activeBox.probability = calculateBreakoutProbability(activeBox, bar, data, i);
          activeBox.endTime = bar.time;
          activeBox.endIdx = i;
          allBoxes.push({ ...activeBox, active: false });
        }
        if (i < data.length - 1) {
          activeBox = null;
        }
      } else if (bar.close < activeBox.bottom) {
        if (!isDeathZone(bar.time)) {
          activeBox.breakoutOccurred = true;
          activeBox.breakoutBar = bar;
          activeBox.breakoutDir = "SHORT";
          activeBox.probability = calculateBreakoutProbability(activeBox, bar, data, i);
          activeBox.endTime = bar.time;
          activeBox.endIdx = i;
          allBoxes.push({ ...activeBox, active: false });
        }
        if (i < data.length - 1) {
          activeBox = null;
        }
      } else if (activeBox.age >= boxTimeout) {
        activeBox.timeoutOccurred = true;
        activeBox.endTime = bar.time;
        activeBox.endIdx = i;
        allBoxes.push({ ...activeBox, active: false });
        activeBox = null;
      }
    }

    if (!activeBox) {
      if (isDeathZone(data[i].time)) {
        continue; // В зоне смерти (Пт 12:00 — Пн 12:00 Киев/МСК) формации не формируются
      }
      const window5 = data.slice(i - 4, i + 1);
      let bearCount = 0;
      let bullCount = 0;
      const bodyHighs = [];
      const bodyLows = [];

      window5.forEach(b => {
        if (b.wickType === "bear_wick") bearCount++;
        if (b.wickType === "bull_wick") bullCount++;
        bodyHighs.push(Math.max(b.open, b.close));
        bodyLows.push(Math.min(b.open, b.close));
      });

      if (bearCount >= 3) {
        activeBox = {
          type: "bear_sequence",
          signalDir: "SHORT",
          startIdx: i,
          startTime: data[i - 4].time, // старт 5-свечной формации
          boxFormTime: data[i].time,
          top: Math.max(...bodyHighs),
          bottom: Math.min(...bodyLows),
          height: Math.max(...bodyHighs) - Math.min(...bodyLows),
          age: 0,
          wickCount: bearCount,
          active: true,
          breakoutOccurred: false
        };
      } else if (bullCount >= 3) {
        activeBox = {
          type: "bull_sequence",
          signalDir: "LONG",
          startIdx: i,
          startTime: data[i - 4].time, // старт 5-свечной формации
          boxFormTime: data[i].time,
          top: Math.max(...bodyHighs),
          bottom: Math.min(...bodyLows),
          height: Math.max(...bodyHighs) - Math.min(...bodyLows),
          age: 0,
          wickCount: bullCount,
          active: true,
          breakoutOccurred: false
        };
      }
    }
  }

  if (activeBox && activeBox.active) {
    allBoxes.push(activeBox);
  }

  // Последние 5 свечей для стрипа
  const last5 = data.slice(data.length - 5);
  let curBearWicks = 0;
  let curBullWicks = 0;
  last5.forEach(b => {
    if (b.wickType === "bear_wick") curBearWicks++;
    if (b.wickType === "bull_wick") curBullWicks++;
  });

  const lastBar = data[data.length - 1];

  // Расчет Order-Flow Дельты и Delta Ratio
  let formDelta = 0;
  let formVol = 0;
  const deltaWindow = activeBox ? Math.min(activeBox.age + 5, 30) : 5;
  const deltaBars = data.slice(data.length - deltaWindow);
  deltaBars.forEach(b => {
    formDelta += (b.delta || 0);
    formVol += (b.volume || 0);
  });
  const deltaRatio = formVol > 0 ? (formDelta / formVol) : 0;

  // Z-Score дельты по окну 100 свечей
  const zWindow = 100;
  const zSlice = data.slice(Math.max(0, data.length - zWindow));
  let zSum = 0;
  zSlice.forEach(b => zSum += (b.delta || 0));
  const zMean = zSum / zSlice.length;
  let zVar = 0;
  zSlice.forEach(b => zVar += Math.pow((b.delta || 0) - zMean, 2));
  const zStd = Math.sqrt(zVar / zSlice.length) || 1.0;
  const currentZScore = ((lastBar.delta || 0) - zMean) / zStd;

  // HTF-Структура (свинги за последние 40 свечей = 10 часов)
  const htfWindow = 40;
  const htfSlice = data.slice(Math.max(0, data.length - htfWindow));
  let htfHigh = -Infinity;
  let htfLow = Infinity;
  htfSlice.forEach(b => {
    if (b.high > htfHigh) htfHigh = b.high;
    if (b.low < htfLow) htfLow = b.low;
  });

  // Расчет SL / TP на основе ATR
  const atr = lastBar.atr || (lastBar.high - lastBar.low);
  let calcSl = 0;
  let calcTp1 = 0;
  let calcTp2 = 0;

  if (activeBox) {
    if (activeBox.signalDir === "LONG") {
      calcSl = activeBox.bottom - 0.5 * atr;
      const risk = Math.max(lastBar.close - calcSl, atr);
      calcTp1 = lastBar.close + risk * 1.0;
      calcTp2 = lastBar.close + risk * 2.0;
    } else {
      calcSl = activeBox.top + 0.5 * atr;
      const risk = Math.max(calcSl - lastBar.close, atr);
      calcTp1 = lastBar.close - risk * 1.0;
      calcTp2 = lastBar.close - risk * 2.0;
    }
  } else {
    calcSl = lastBar.close - 1.5 * atr;
    calcTp1 = lastBar.close + 1.5 * atr;
    calcTp2 = lastBar.close + 3.0 * atr;
  }

  return {
    last5,
    curBearWicks,
    curBullWicks,
    activeBox,
    allBoxes,
    deltaRatio,
    formDelta,
    formVol,
    currentZScore,
    htfHigh,
    htfLow,
    atr,
    calcSl,
    calcTp1,
    calcTp2
  };
}

/**
 * Отрисовка WSB Бокса прямо на графике прямоугольником (а не линиями)
 */
function updateWSBBoxLines(box) {
  if (wsbBoxTopLine) {
    try { candleSeries.removePriceLine(wsbBoxTopLine); } catch (e) {}
    wsbBoxTopLine = null;
  }
  if (wsbBoxBottomLine) {
    try { candleSeries.removePriceLine(wsbBoxBottomLine); } catch (e) {}
    wsbBoxBottomLine = null;
  }
  renderWSBBoxOverlay();
}

/**
 * Рендерер SVG-прямоугольников для WSB Боксов
 */
function renderWSBBoxOverlay() {
  const svg = document.getElementById("wsb-box-svg-overlay");
  if (!svg) return;
  svg.innerHTML = "";

  if (!isWsbBoxVisible || !chart || !candleSeries || !wsbCurrentState) return;

  const boxesToDraw = [];
  if (wsbCurrentState.allBoxes && wsbCurrentState.allBoxes.length > 0) {
    const recents = wsbCurrentState.allBoxes.slice(-6);
    recents.forEach(b => boxesToDraw.push(b));
  } else if (wsbCurrentState.activeBox) {
    boxesToDraw.push(wsbCurrentState.activeBox);
  }

  if (boxesToDraw.length === 0) return;

  const container = document.getElementById("tv-chart-container");
  if (!container) return;
  const paneWidth = (chart.paneSize ? chart.paneSize().width : container.clientWidth - 65);
  const visibleRange = chart.timeScale().getVisibleRange();

  boxesToDraw.forEach(box => {
    if (!box || !box.top || !box.bottom || !box.startTime) return;

    let endTime = box.endTime;
    if (!endTime) {
      if (box.breakoutOccurred && box.breakoutBar) {
        endTime = box.breakoutBar.time;
      } else if (klinesData.length > 0) {
        endTime = klinesData[klinesData.length - 1].time;
      } else {
        endTime = box.startTime;
      }
    }

    if (visibleRange) {
      if (endTime < visibleRange.from) return;
      if (box.startTime > visibleRange.to) return;
    }

    let x1 = chart.timeScale().timeToCoordinate(box.startTime);
    let x2 = chart.timeScale().timeToCoordinate(endTime);

    if (x1 === null) {
      x1 = (visibleRange && box.startTime < visibleRange.from) ? -20 : 0;
    }

    if (box.active && !box.breakoutOccurred) {
      const lastBar = klinesData[klinesData.length - 1];
      const lastX = lastBar ? chart.timeScale().timeToCoordinate(lastBar.time) : null;
      if (lastX !== null) {
        x2 = Math.min(paneWidth, lastX + 35);
      } else {
        x2 = paneWidth;
      }
    } else if (x2 === null) {
      x2 = (visibleRange && endTime > visibleRange.to) ? paneWidth + 20 : x1 + 80;
    }

    const yTop = candleSeries.priceToCoordinate(box.top);
    const yBottom = candleSeries.priceToCoordinate(box.bottom);

    if (yTop === null || yBottom === null) return;

    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const top = Math.min(yTop, yBottom);
    const bottom = Math.max(yTop, yBottom);
    const width = Math.max(16, right - left);
    const height = Math.max(4, bottom - top);

    const isBear = box.signalDir === "SHORT" || box.type === "bear_sequence";
    const primaryColor = isBear ? "#38bdf8" : "#10b981";
    const fillColor = isBear 
      ? (box.active ? "rgba(56, 189, 248, 0.20)" : "rgba(56, 189, 248, 0.08)")
      : (box.active ? "rgba(16, 185, 129, 0.20)" : "rgba(16, 185, 129, 0.08)");
    const strokeDash = box.active ? "none" : "6,4";
    const strokeWidth = box.active ? "2.5" : "1.5";

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", `wsb-box-item ${box.active ? "box-active" : "box-historical"}`);

    // 1. Прямоугольник бокса
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", left);
    rect.setAttribute("y", top);
    rect.setAttribute("width", width);
    rect.setAttribute("height", height);
    rect.setAttribute("rx", "4");
    rect.setAttribute("ry", "4");
    rect.setAttribute("fill", fillColor);
    rect.setAttribute("stroke", primaryColor);
    rect.setAttribute("stroke-width", strokeWidth);
    if (strokeDash !== "none") rect.setAttribute("stroke-dasharray", strokeDash);
    g.appendChild(rect);

    // 2. Средняя линия (Midline / POC)
    const midY = top + height / 2;
    const midLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
    midLine.setAttribute("x1", left);
    midLine.setAttribute("y1", midY);
    midLine.setAttribute("x2", left + width);
    midLine.setAttribute("y2", midY);
    midLine.setAttribute("stroke", primaryColor);
    midLine.setAttribute("stroke-width", "1");
    midLine.setAttribute("stroke-dasharray", "4,4");
    midLine.setAttribute("stroke-opacity", "0.6");
    g.appendChild(midLine);

    // 3. Бейдж сверху (VAH)
    if (width > 60) {
      const topBadgeRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      const badgeY = top - 18 > 10 ? top - 18 : top + 3;
      topBadgeRect.setAttribute("x", left + 4);
      topBadgeRect.setAttribute("y", badgeY);
      topBadgeRect.setAttribute("width", Math.min(210, width - 8));
      topBadgeRect.setAttribute("height", "16");
      topBadgeRect.setAttribute("rx", "3");
      topBadgeRect.setAttribute("fill", "rgba(9, 14, 23, 0.90)");
      topBadgeRect.setAttribute("stroke", primaryColor);
      topBadgeRect.setAttribute("stroke-width", "1");
      g.appendChild(topBadgeRect);

      const topText = document.createElementNS("http://www.w3.org/2000/svg", "text");
      topText.setAttribute("x", left + 8);
      topText.setAttribute("y", badgeY + 12);
      topText.setAttribute("fill", primaryColor);
      topText.setAttribute("font-size", "10");
      topText.setAttribute("font-weight", "700");
      topText.setAttribute("font-family", "'JetBrains Mono', monospace");
      topText.textContent = `📦 WSB ${isBear ? 'BEAR' : 'BULL'} VAH $${box.top.toFixed(2)}`;
      g.appendChild(topText);

      // 4. Текст снизу (VAL)
      if (height > 28) {
        const botText = document.createElementNS("http://www.w3.org/2000/svg", "text");
        botText.setAttribute("x", left + 8);
        botText.setAttribute("y", bottom - 6);
        botText.setAttribute("fill", "#c084fc");
        botText.setAttribute("font-size", "9");
        botText.setAttribute("font-weight", "600");
        botText.setAttribute("font-family", "'JetBrains Mono', monospace");
        botText.textContent = `VAL $${box.bottom.toFixed(2)} (ΔH $${box.height.toFixed(2)})`;
        g.appendChild(botText);
      }
    }

    // 5. Метка пробоя
    if (box.breakoutOccurred && width > 40) {
      const breakText = document.createElementNS("http://www.w3.org/2000/svg", "text");
      breakText.setAttribute("x", left + width - 6);
      breakText.setAttribute("y", top + 14);
      breakText.setAttribute("text-anchor", "end");
      breakText.setAttribute("fill", box.breakoutDir === "LONG" ? "#10b981" : "#f43f5e");
      breakText.setAttribute("font-size", "10");
      breakText.setAttribute("font-weight", "800");
      breakText.setAttribute("font-family", "'Inter', sans-serif");
      breakText.textContent = `💥 ПРОБОЙ ${box.breakoutDir}`;
      g.appendChild(breakText);
    }

    svg.appendChild(g);
  });
}

function updateWSBUI(wsb, last) {
  if (!wsb || !last) return;

  // 1. Стрип 5 свечей
  const strip = wsb.last5;
  for (let i = 0; i < 5; i++) {
    const idx = 4 - i; // 4: NOW, 3: S-1, 2: S-2, 1: S-3, 0: S-4
    const cell = document.getElementById(`wc-${idx}`);
    if (cell && strip[i]) {
      const b = strip[i];
      let icon = "⚪";
      let clr = "#64748b";
      let title = `Обычная свеча (Тело)`;

      if (b.wickType === "bear_wick") {
        icon = "🔴";
        clr = "#f43f5e";
        title = `Медвежий фитиль: Верхняя тень ${b.upperWickPct}%`;
      } else if (b.wickType === "bull_wick") {
        icon = "🟢";
        clr = "#10b981";
        title = `Бычий фитиль: Нижняя тень ${b.lowerWickPct}%`;
      }

      const iconEl = cell.querySelector(".wc-icon");
      if (iconEl) iconEl.textContent = icon;
      cell.title = title;
      cell.style.borderColor = b.wickType !== "none" ? clr : "rgba(255,255,255,0.08)";
    }
  }

  // Счетчик фитилей
  const wicksCountEl = document.getElementById("wsb-wicks-count");
  const wicksStatusEl = document.getElementById("wsb-wicks-status");
  const wickInfoEl = document.getElementById("wsb-current-wick-info");

  if (wicksCountEl) {
    if (wsb.curBearWicks >= wsb.curBullWicks) {
      wicksCountEl.textContent = `${wsb.curBearWicks} / 5 (Bear)`;
      wicksCountEl.className = `ind-current-val ${wsb.curBearWicks >= 3 ? "text-red" : ""}`;
    } else {
      wicksCountEl.textContent = `${wsb.curBullWicks} / 5 (Bull)`;
      wicksCountEl.className = `ind-current-val ${wsb.curBullWicks >= 3 ? "text-green" : ""}`;
    }
  }

  if (wicksStatusEl) {
    if (wsb.curBearWicks >= 3) {
      wicksStatusEl.innerHTML = `<span class="text-red">Медвежья формация активна (${wsb.curBearWicks}/5)</span>`;
    } else if (wsb.curBullWicks >= 3) {
      wicksStatusEl.innerHTML = `<span class="text-green">Бычья формация активна (${wsb.curBullWicks}/5)</span>`;
    } else {
      wicksStatusEl.innerHTML = `Сканирование: Bear ${wsb.curBearWicks}/5 • Bull ${wsb.curBullWicks}/5`;
    }
  }

  if (wickInfoEl) {
    wickInfoEl.textContent = `Верхняя: ${last.upperWickPct || 0}% | Нижняя: ${last.lowerWickPct || 0}%`;
  }

  // 2. Активный бокс
  const box = wsb.activeBox;
  const boxTypeTag = document.getElementById("wsb-box-type-tag");
  const boxAgeBadge = document.getElementById("wsb-box-age-badge");
  const boxAgeFill = document.getElementById("wsb-box-age-fill");
  const boxTopEl = document.getElementById("wsb-box-top");
  const boxBottomEl = document.getElementById("wsb-box-bottom");
  const boxHeightEl = document.getElementById("wsb-box-height");
  const boxCondEl = document.getElementById("wsb-box-condition");

  if (box && box.active) {
    const isBear = box.signalDir === "SHORT";
    if (boxTypeTag) {
      boxTypeTag.textContent = isBear ? "МЕДВЕЖИЙ БОКС (ШОРТ)" : "БЫЧИЙ БОКС (ЛОНГ)";
      boxTypeTag.style.color = isBear ? "#f43f5e" : "#10b981";
    }

    if (boxAgeBadge) boxAgeBadge.textContent = `${box.age} / 100 БАРОВ`;
    if (boxAgeFill) boxAgeFill.style.width = `${Math.min(100, box.age)}%`;

    if (boxTopEl) boxTopEl.textContent = `$${box.top.toFixed(2)}`;
    if (boxBottomEl) boxBottomEl.textContent = `$${box.bottom.toFixed(2)}`;
    if (boxHeightEl) boxHeightEl.textContent = `$${box.height.toFixed(2)}`;

    if (boxCondEl) {
      if (box.breakoutOccurred) {
        boxCondEl.innerHTML = `<b class="text-gold">⚡ ПРОБОЙ ЗАФИКСИРОВАН! Close: $${last.close.toFixed(2)}</b>`;
      } else if (isBear) {
        const distToBreak = last.close - box.bottom;
        boxCondEl.innerHTML = `Шорт пробой при Close &lt; <b class="text-red">$${box.bottom.toFixed(2)}</b> (Осталось $${distToBreak.toFixed(2)})`;
      } else {
        const distToBreak = box.top - last.close;
        boxCondEl.innerHTML = `Лонг пробой при Close &gt; <b class="text-green">$${box.top.toFixed(2)}</b> (Осталось $${distToBreak.toFixed(2)})`;
      }
    }
  } else {
    if (boxTypeTag) {
      boxTypeTag.textContent = "НЕТ АКТИВНОГО БОКСА";
      boxTypeTag.style.color = "#94a3b8";
    }
    if (boxAgeBadge) boxAgeBadge.textContent = "0 / 100 БАРОВ";
    if (boxAgeFill) boxAgeFill.style.width = "0%";
    if (boxTopEl) boxTopEl.textContent = "$----.--";
    if (boxBottomEl) boxBottomEl.textContent = "$----.--";
    if (boxHeightEl) boxHeightEl.textContent = "$0.00";
    if (boxCondEl) boxCondEl.textContent = "Ожидание формации 3 из 5 для фиксации границ...";
  }

  // 3. Дельта и Delta-Ratio
  const deltaRatioValEl = document.getElementById("wsb-delta-ratio-val");
  const needleEl = document.getElementById("wsb-delta-needle");
  const deltaStatusEl = document.getElementById("wsb-delta-status");
  const deltaDetailsEl = document.getElementById("wsb-delta-details");
  const deltaBreakoutEl = document.getElementById("wsb-delta-breakout-val");

  const dr = wsb.deltaRatio;
  if (deltaRatioValEl) {
    deltaRatioValEl.textContent = (dr >= 0 ? "+" : "") + dr.toFixed(3);
    deltaRatioValEl.className = `ind-current-val ${dr > 0.15 ? "text-green" : dr < -0.15 ? "text-red" : "text-muted"}`;
  }

  if (needleEl) {
    const clampedDr = Math.max(-1.0, Math.min(1.0, dr));
    const needleLeft = ((clampedDr + 1.0) / 2.0) * 100;
    needleEl.style.left = `${needleLeft}%`;
  }

  if (deltaStatusEl) {
    if (dr > 0.15) {
      deltaStatusEl.innerHTML = `<span class="text-green">Бычий импульс покупок (δ-ratio &gt; +0.15)</span>`;
    } else if (dr < -0.15) {
      deltaStatusEl.innerHTML = `<span class="text-red">Медвежий импульс продаж (δ-ratio &lt; -0.15)</span>`;
    } else {
      deltaStatusEl.innerHTML = `<span class="text-muted">Мертвая зона нейтрального потока (|δ| &lt; 0.15)</span>`;
    }
  }

  if (deltaDetailsEl) {
    deltaDetailsEl.textContent = `δ: ${(wsb.formDelta >= 0 ? "+" : "")}${wsb.formDelta.toFixed(1)} oz / Объем: ${wsb.formVol.toFixed(1)} oz`;
  }
  if (deltaBreakoutEl) {
    const lastDelta = last.delta || 0;
    deltaBreakoutEl.textContent = `${lastDelta >= 0 ? "+" : ""}${lastDelta.toFixed(1)} oz (${(last.volume > 0 ? (lastDelta / last.volume * 100).toFixed(1) : 0)}%)`;
  }

  // 4. Z-Score Режимные ворота
  const zValEl = document.getElementById("wsb-zscore-val");
  const zBadgeEl = document.getElementById("wsb-zscore-badge");
  const zStatusEl = document.getElementById("wsb-zscore-status");

  const z = wsb.currentZScore;
  if (zValEl) {
    zValEl.textContent = (z >= 0 ? "+" : "") + z.toFixed(2);
  }
  const isGateOpen = Math.abs(z) >= 1.0;
  if (zBadgeEl) {
    zBadgeEl.textContent = isGateOpen ? "ОТКРЫТЫ" : "ЗАКРЫТЫ";
    zBadgeEl.className = `z-gate-badge ${isGateOpen ? "open" : ""}`;
  }
  if (zStatusEl) {
    if (isGateOpen) {
      zStatusEl.innerHTML = `<span class="text-gold">Ворота открыты! Высокая волатильность (|z| ≥ 1.0)</span>`;
    } else {
      zStatusEl.innerHTML = `Рынок сжат (|z| &lt; 1.0, вход запрещен)`;
    }
  }

  // 5. HTF-Структура
  const htfBadgeEl = document.getElementById("wsb-htf-badge");
  const htfResEl = document.getElementById("wsb-htf-res");
  const htfSupEl = document.getElementById("wsb-htf-sup");
  const htfStatusEl = document.getElementById("wsb-htf-status");

  if (htfResEl) htfResEl.textContent = `$${wsb.htfHigh.toFixed(2)}`;
  if (htfSupEl) htfSupEl.textContent = `$${wsb.htfLow.toFixed(2)}`;

  const distToRes = wsb.htfHigh - last.close;
  const distToSup = last.close - wsb.htfLow;

  if (htfBadgeEl) {
    if (distToRes < 0.2 * (wsb.htfHigh - wsb.htfLow)) {
      htfBadgeEl.textContent = "У СОПРОТИВЛЕНИЯ";
      htfBadgeEl.className = "htf-badge res";
    } else if (distToSup < 0.2 * (wsb.htfHigh - wsb.htfLow)) {
      htfBadgeEl.textContent = "У ПОДДЕРЖКИ";
      htfBadgeEl.className = "htf-badge sup";
    } else {
      htfBadgeEl.textContent = "В ДИАПАЗОНЕ";
      htfBadgeEl.className = "htf-badge";
    }
  }
  if (htfStatusEl) {
    htfStatusEl.innerHTML = `До сопр.: <b class="text-red">$${distToRes.toFixed(2)}</b> | До подд.: <b class="text-green">$${distToSup.toFixed(2)}</b>`;
  }

  // 6. Уровни SL/TP и ATR
  const atrValEl = document.getElementById("wsb-atr-val");
  const slEl = document.getElementById("wsb-calc-sl");
  const tp1El = document.getElementById("wsb-calc-tp1");
  const tp2El = document.getElementById("wsb-calc-tp2");

  if (atrValEl) atrValEl.textContent = `ATR(14): $${wsb.atr.toFixed(2)}`;
  if (slEl) slEl.textContent = `$${wsb.calcSl.toFixed(2)}`;
  if (tp1El) tp1El.textContent = `$${wsb.calcTp1.toFixed(2)}`;
  if (tp2El) tp2El.textContent = `$${wsb.calcTp2.toFixed(2)}`;

  // 7. Радары готовности пробоя WSB
  let longReady = 0;
  let shortReady = 0;

  if (box && box.active) {
    if (box.signalDir === "LONG") {
      longReady += 40;
      if (dr > 0.15) longReady += 30;
      if (isGateOpen) longReady += 20;
      if (last.close > box.top) longReady += 10;
    } else {
      shortReady += 40;
      if (dr < -0.15) shortReady += 30;
      if (isGateOpen) shortReady += 20;
      if (last.close < box.bottom) shortReady += 10;
    }
  } else {
    longReady = Math.round((wsb.curBullWicks / 3) * 35);
    shortReady = Math.round((wsb.curBearWicks / 3) * 35);
  }

  const elLongPct = document.getElementById("wsb-long-pct");
  const elLongProg = document.getElementById("wsb-long-progress");
  const elLongDesc = document.getElementById("wsb-long-desc");
  if (elLongPct) elLongPct.textContent = `${longReady}%`;
  if (elLongProg) elLongProg.style.width = `${longReady}%`;
  if (elLongDesc) elLongDesc.textContent = longReady >= 90 ? "🔥 ПРОБОЙ ВВЕРХ! СИГНАЛ В ЛОНГ" : `Готовность гейтов: ${longReady}%`;

  const elShortPct = document.getElementById("wsb-short-pct");
  const elShortProg = document.getElementById("wsb-short-progress");
  const elShortDesc = document.getElementById("wsb-short-desc");
  if (elShortPct) elShortPct.textContent = `${shortReady}%`;
  if (elShortProg) elShortProg.style.width = `${shortReady}%`;
  if (elShortDesc) elShortDesc.textContent = shortReady >= 90 ? "🔥 ПРОБОЙ ВНИЗ! СИГНАЛ В ШОРТ" : `Готовность гейтов: ${shortReady}%`;

  // 8. Обновление Hero карточки статуса WSB
  if (activeStrategy === "wsb") {
    const cardTitle = document.getElementById("strategy-status-title");
    const stateText = document.getElementById("strategy-state-text");
    const subText = document.getElementById("strategy-sub-text");

    if (cardTitle) cardTitle.textContent = "⚡ СТАТУС WSB ORDER-FLOW";

    if (isDeathZone(last.time)) {
      if (stateText) {
        stateText.textContent = "ЗОНА СМЕРТИ (ВЫХОДНЫЕ)";
        stateText.className = "status-state text-muted";
      }
      if (subText) subText.textContent = "Пятница 12:00 — Понедельник 12:00 (Киев/МСК). Прогнозы заблокированы.";
    } else if (longReady >= 90) {
      if (stateText) {
        stateText.textContent = "СИГНАЛ ЛОНГ (ПРОБОЙ)";
        stateText.className = "status-state text-green";
      }
      if (subText) subText.textContent = `Close $${last.close.toFixed(2)} > Бокс $${box ? box.top.toFixed(2) : "" } | δ-ratio: ${dr.toFixed(2)} | SL: $${wsb.calcSl.toFixed(2)}`;
    } else if (shortReady >= 90) {
      if (stateText) {
        stateText.textContent = "СИГНАЛ ШОРТ (ПРОБОЙ)";
        stateText.className = "status-state text-red";
      }
      if (subText) subText.textContent = `Close $${last.close.toFixed(2)} < Бокс $${box ? box.bottom.toFixed(2) : "" } | δ-ratio: ${dr.toFixed(2)} | SL: $${wsb.calcSl.toFixed(2)}`;
    } else if (box && box.active) {
      if (stateText) {
        stateText.textContent = `АКТИВЕН ${box.signalDir === "LONG" ? "БЫЧИЙ" : "МЕДВЕЖИЙ"} БОКС`;
        stateText.className = box.signalDir === "LONG" ? "status-state text-green" : "status-state text-red";
      }
      if (subText) subText.textContent = `Границы: $${box.bottom.toFixed(2)} - $${box.top.toFixed(2)} | Возраст: ${box.age}/100 баров`;
    } else {
      if (stateText) {
        stateText.textContent = "СКАНИРОВАНИЕ WICK-СВЕЧЕЙ";
        stateText.className = "status-state text-cyan";
      }
      if (subText) subText.textContent = `Тени 5 свечей: Bear ${wsb.curBearWicks}/5 • Bull ${wsb.curBullWicks}/5`;
    }
  }
}

// ============================================================
// 5. ИНИЦИАЛИЗАЦИЯ ГРАФИКА TRADINGVIEW LIGHTWEIGHT CHARTS
// ============================================================

function initChart() {
  const container = document.getElementById("tv-chart-container");
  container.innerHTML = ""; // очищаем лоадер

  chart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: container.clientHeight,
    layout: {
      background: { color: "#090e17" },
      textColor: "#94a3b8",
      fontFamily: "'Inter', sans-serif"
    },
    localization: {
      locale: "ru-RU",
      timeFormatter: (timestamp) => {
        const d = new Date(timestamp * 1000);
        const locTime = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
        const utcTime = d.toLocaleTimeString("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" });
        const dateStr = d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
        return `${dateStr}  •  ${locTime} (Киев) / ${utcTime} (UTC)`;
      }
    },
    grid: {
      vertLines: { color: "rgba(255, 255, 255, 0.04)" },
      horzLines: { color: "rgba(255, 255, 255, 0.04)" }
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: { color: "rgba(255, 255, 255, 0.2)", width: 1, style: 2 },
      horzLine: { color: "rgba(255, 255, 255, 0.2)", width: 1, style: 2 }
    },
    rightPriceScale: {
      borderColor: "rgba(255, 255, 255, 0.08)"
    },
    timeScale: {
      borderColor: "rgba(255, 255, 255, 0.08)",
      timeVisible: true,
      secondsVisible: false,
      tickMarkFormatter: (time, tickMarkType) => {
        const d = new Date(time * 1000);
        const locH = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
        const utcH = String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0");
        if (tickMarkType === 0) return String(d.getFullYear());
        if (tickMarkType === 1 || tickMarkType === 2) {
          return `${d.getDate()} ${d.toLocaleDateString("ru-RU", { month: "short" })}`;
        }
        return `${locH} / ${utcH}u`;
      }
    }
  });

  // 1. Свечная серия
  candleSeries = chart.addCandlestickSeries({
    upColor: "#10b981",
    downColor: "#f43f5e",
    borderUpColor: "#10b981",
    borderDownColor: "#f43f5e",
    wickUpColor: "#10b981",
    wickDownColor: "#f43f5e"
  });

  // 2. Линии VWAP (Белые)
  vwapMidSeries = chart.addLineSeries({
    color: "#ffffff",
    lineWidth: 2,
    title: "VWAP"
  });

  vwapUpper1Series = chart.addLineSeries({
    color: "#cbd5e1",
    lineWidth: 1,
    lineStyle: LightweightCharts.LineStyle.Dashed,
    title: "VWAP +1.0%"
  });

  vwapLower1Series = chart.addLineSeries({
    color: "#cbd5e1",
    lineWidth: 1,
    lineStyle: LightweightCharts.LineStyle.Dashed,
    title: "VWAP -1.0%"
  });

  vwapUpper2Series = chart.addLineSeries({
    color: "#ffffff",
    lineWidth: 2,
    title: "VWAP +1.5%"
  });

  vwapLower2Series = chart.addLineSeries({
    color: "#ffffff",
    lineWidth: 2,
    title: "VWAP -1.5%"
  });

  // 3. Полосы Боллинджера (Оранжевые, BB 16, 3.9)
  bbUpperSeries = chart.addLineSeries({
    color: "#ff8c00",
    lineWidth: 2,
    title: "BB Upper (3.9σ)"
  });

  bbMidSeries = chart.addLineSeries({
    color: "#ff8c00",
    lineWidth: 1,
    lineStyle: LightweightCharts.LineStyle.Dashed,
    title: "BB Mid"
  });

  bbLowerSeries = chart.addLineSeries({
    color: "#ff8c00",
    lineWidth: 2,
    title: "BB Lower (3.9σ)"
  });

  // Подписка на движение перекрестия — обновление двойного времени (Киев / UTC) и OHLC
  chart.subscribeCrosshairMove((param) => {
    if (param && param.time) {
      isCrosshairHovering = true;
      updateDualTimeDisplay(param);
    } else {
      isCrosshairHovering = false;
      updateDualTimeDisplay(null);
    }
  });

  container.addEventListener("mouseleave", () => {
    isCrosshairHovering = false;
    updateDualTimeDisplay(null);
  });

  // Авто-ресайз при изменении окна
  window.addEventListener("resize", () => {
    if (chart && container) {
      chart.applyOptions({
        width: container.clientWidth,
        height: container.clientHeight
      });
      setTimeout(renderWSBBoxOverlay, 50);
    }
  });

  // 4. SVG Оверлей для отрисовки прямоугольников WSB Бокса
  let svgOverlay = document.getElementById("wsb-box-svg-overlay");
  if (!svgOverlay) {
    svgOverlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgOverlay.setAttribute("id", "wsb-box-svg-overlay");
    svgOverlay.style.position = "absolute";
    svgOverlay.style.top = "0";
    svgOverlay.style.left = "0";
    svgOverlay.style.width = "100%";
    svgOverlay.style.height = "100%";
    svgOverlay.style.pointerEvents = "none";
    svgOverlay.style.zIndex = "8";
    svgOverlay.style.overflow = "hidden";
    container.appendChild(svgOverlay);
  }

  // Подписка на масштабирование и панорамирование для рендеринга прямоугольников
  chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
    renderWSBBoxOverlay();
  });
}

/**
 * Обновление панели двойного времени: Моё локальное (Киев) и UTC (УСТ / Биржа)
 */
function updateDualTimeDisplay(param) {
  let targetCandle = null;
  let timestamp = null;

  if (param && param.time) {
    timestamp = param.time;
    if (param.seriesData && candleSeries) {
      targetCandle = param.seriesData.get(candleSeries);
    }
    if (!targetCandle && klinesData.length > 0) {
      targetCandle = klinesData.find(k => k.time === timestamp);
    }
  } else if (klinesData.length > 0) {
    // По умолчанию — последняя свеча
    targetCandle = klinesData[klinesData.length - 1];
    timestamp = targetCandle.time;
  }

  if (!timestamp) return;

  const d = new Date(timestamp * 1000);
  const localTime = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const utcTime = d.toLocaleTimeString("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" });
  const dateStr = d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });

  const elLocal = document.getElementById("dt-local-time");
  const elUtc = document.getElementById("dt-utc-time");
  const elDate = document.getElementById("dt-candle-date");

  if (elLocal) elLocal.textContent = localTime;
  if (elUtc) elUtc.textContent = utcTime;
  if (elDate) elDate.textContent = `•  ${dateStr}`;

  if (targetCandle) {
    const elO = document.getElementById("dt-open");
    const elH = document.getElementById("dt-high");
    const elL = document.getElementById("dt-low");
    const elC = document.getElementById("dt-close");
    const elChg = document.getElementById("dt-chg");

    if (elO && targetCandle.open) elO.textContent = `$${targetCandle.open.toFixed(2)}`;
    if (elH && targetCandle.high) elH.textContent = `$${targetCandle.high.toFixed(2)}`;
    if (elL && targetCandle.low) elL.textContent = `$${targetCandle.low.toFixed(2)}`;
    if (elC && targetCandle.close) elC.textContent = `$${targetCandle.close.toFixed(2)}`;

    if (elChg && targetCandle.open && targetCandle.close) {
      const diff = targetCandle.close - targetCandle.open;
      const pct = (diff / targetCandle.open) * 100;
      const sign = pct >= 0 ? "+" : "";
      elChg.textContent = `${sign}${pct.toFixed(2)}%`;
      elChg.style.color = pct >= 0 ? "#10b981" : "#f43f5e";
    }
  }
}

function updateChartSeries(data) {
  if (!chart || data.length === 0) return;

  const candleData = [];
  const vwapMidData = [];
  const vwapU1Data = [];
  const vwapL1Data = [];
  const vwapU2Data = [];
  const vwapL2Data = [];
  const bbUData = [];
  const bbMidData = [];
  const bbLData = [];

  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    const t = d.time;

    candleData.push({ time: t, open: d.open, high: d.high, low: d.low, close: d.close });
    if (d.vwap) {
      vwapMidData.push({ time: t, value: d.vwap });
      vwapU1Data.push({ time: t, value: d.vwapU1 });
      vwapL1Data.push({ time: t, value: d.vwapL1 });
      vwapU2Data.push({ time: t, value: d.vwapU2 });
      vwapL2Data.push({ time: t, value: d.vwapL2 });
    }
    if (d.bbUpper) {
      bbUData.push({ time: t, value: d.bbUpper });
      bbMidData.push({ time: t, value: d.bbMid });
      bbLData.push({ time: t, value: d.bbLower });
    }
  }

  candleSeries.setData(candleData);
  if (isVwapVisible) {
    vwapMidSeries.setData(vwapMidData);
    vwapUpper1Series.setData(vwapU1Data);
    vwapLower1Series.setData(vwapL1Data);
    vwapUpper2Series.setData(vwapU2Data);
    vwapLower2Series.setData(vwapL2Data);
  }
  if (isBbVisible) {
    bbUpperSeries.setData(bbUData);
    bbMidSeries.setData(bbMidData);
    bbLowerSeries.setData(bbLData);
  }

  // Обновление треугольников сделок и прямоугольников РОЙ
  if (isMarkersVisible) {
    updateTradeMarkers(data);
  } else {
    candleSeries.setMarkers([]);
  }

  // Обновление панели двойного времени для последней актуальной свечи
  updateDualTimeDisplay(null);
}

/**
 * Загрузка истории сделок из trades.csv
 */
async function loadTradesCsv() {
  try {
    const csvUrl = (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL) 
      ? chrome.runtime.getURL("trades.csv") 
      : "trades.csv?v=" + Date.now();
    const resp = await fetch(csvUrl);
    if (!resp.ok) {
      console.warn("trades.csv не найден:", resp.status);
      return;
    }
    const text = await resp.text();
    const lines = text.trim().split("\n");
    const trades = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const cols = line.split(",");
      if (cols.length < 12) continue;

      const entryStr = cols[0].trim();
      const exitStr = cols[1].trim();
      const dir = cols[3].trim().toUpperCase();
      const entryPrice = parseFloat(cols[4]);
      const exitPrice = parseFloat(cols[5]);
      const pnlPct = parseFloat(cols[8]); // в % (например 0.1471 или -1.0427)
      const reason = cols[11].trim();

      const entryTime = Math.floor(new Date(entryStr.replace(" ", "T") + "Z").getTime() / 1000);
      const exitTime = Math.floor(new Date(exitStr.replace(" ", "T") + "Z").getTime() / 1000);

      trades.push({
        entryTime,
        exitTime,
        dir,
        entryPrice,
        exitPrice,
        pnlPct,
        reason
      });
    }
    historicalTrades = trades;
    console.log(`[TRADES] Загружено ${historicalTrades.length} подтвержденных сделок из trades.csv`);
  } catch (e) {
    console.warn("Ошибка парсинга trades.csv:", e);
  }
}

/**
 * Отрисовка сделок на графике:
 * - Зеленый треугольник на покупку (▲ LONG) снизу свечи
 * - Красный треугольник на продажу (▼ SHORT) сверху свечи
 * - Прямоугольник при закрытии сделки с указанием РОЙ в % снизу свечи
 * Включает как подтвержденные сделки из trades.csv, так и расчет live-сигналов.
 */
function updateTradeMarkers(data) {
  if (!candleSeries || data.length < 10) return;

  const markers = [];
  const minTime = data[0].time;
  const maxTime = data[data.length - 1].time;
  const candleTimeSet = new Set(data.map(d => d.time));

  function findCandleTime(ts) {
    if (candleTimeSet.has(ts)) return ts;
    if (candleTimeSet.has(ts - 900)) return ts - 900;
    if (candleTimeSet.has(ts + 900)) return ts + 900;
    return null;
  }

  // ════════════════════════════════════════════════════════════
  // 1. WSB ORDER-FLOW (ПРОБОИ БОКСОВ И ВЫХОДЫ)
  // ════════════════════════════════════════════════════════════
  if (activeStrategy === "wsb") {
    const wsb = wsbCurrentState || calculateWSBOrderFlow(data);
    const boxes = [];
    if (wsb && wsb.allBoxes) {
      boxes.push(...wsb.allBoxes);
    }
    if (wsb && wsb.activeBox && wsb.activeBox.breakoutOccurred) {
      if (!boxes.some(b => b.startTime === wsb.activeBox.startTime)) {
        boxes.push(wsb.activeBox);
      }
    }

    const seenBreakouts = new Set();
    const tradePositions = [];

    boxes.forEach(box => {
      if (box.breakoutOccurred && box.breakoutBar) {
        const bBar = box.breakoutBar;
        if (isDeathZone(bBar.time)) return; // В зоне смерти (Пт 12:00 — Пн 12:00 Киев/МСК) прогнозы не делаем

        const key = `${bBar.time}_${box.breakoutDir}`;
        if (seenBreakouts.has(key)) return;
        seenBreakouts.add(key);

        const prob = box.probability || calculateBreakoutProbability(box, bBar, data);
        if (box.breakoutDir === "LONG") {
          // Зеленый треугольник ПОД свечой в момент пробоя вверх с вероятностью
          markers.push({
            time: bBar.time,
            position: "belowBar",
            color: "#10b981",
            shape: "arrowUp",
            text: `W ${prob}%`,
            size: 2
          });
        } else {
          // Красный треугольник НАД свечой в момент пробоя вниз с вероятностью
          markers.push({
            time: bBar.time,
            position: "aboveBar",
            color: "#f43f5e",
            shape: "arrowDown",
            text: `R ${prob}%`,
            size: 2
          });
        }

        tradePositions.push({
          dir: box.breakoutDir,
          entryTime: bBar.time,
          entryPrice: bBar.close,
          boxTop: box.top,
          boxBottom: box.bottom,
          atr: bBar.atr || 5.0
        });
      }
    });

    // Сопровождение сделок WSB: 3-ступенчатый Take Profit (+0.5% [50%], +0.75% [25%], +1.00% [25%]) и трейлинг-стоп (Б/У, +0.5%)
    tradePositions.forEach(tp => {
      const startIdx = data.findIndex(d => d.time === tp.entryTime);
      if (startIdx === -1 || startIdx >= data.length - 1) return;

      const riskDist = tp.atr * 1.5;
      const isLong = tp.dir === "LONG";
      let currentSl = isLong ? Math.min(tp.entryPrice - riskDist, tp.boxBottom) : Math.max(tp.entryPrice + riskDist, tp.boxTop);

      // 3 ступени тейк-профита: +0.50%, +0.75%, +1.00%
      const tp1Price = isLong ? tp.entryPrice * 1.005 : tp.entryPrice * 0.995;
      const tp2Price = isLong ? tp.entryPrice * 1.0075 : tp.entryPrice * 0.9925;
      const tp3Price = isLong ? tp.entryPrice * 1.010 : tp.entryPrice * 0.990;

      // Уровни стопа: Б/У (+ комиссия) и фиксация +0.5%
      const bePrice = isLong ? tp.entryPrice * 1.0004 : tp.entryPrice * 0.9996;
      const protectHalfPrice = isLong ? tp.entryPrice * 1.005 : tp.entryPrice * 0.995;

      let stage = 0; // 0 = 100% открыто, 1 = 50% закрыто (стоп в Б/У), 2 = 75% закрыто (стоп в +0.5%)

      for (let j = startIdx + 1; j < Math.min(startIdx + 150, data.length); j++) {
        const bar = data[j];

        if (stage === 0) {
          if (isLong) {
            if (bar.low <= currentSl) {
              const pnl = ((currentSl - tp.entryPrice) / tp.entryPrice) * 100 - 0.04;
              markers.push({
                time: bar.time,
                position: "belowBar",
                color: "#f43f5e",
                shape: "square",
                text: `■ [РОЙ: ${pnl.toFixed(2)}%] (Stop Loss)`,
                size: 2
              });
              break;
            } else if (bar.high >= tp1Price) {
              markers.push({
                time: bar.time,
                position: "belowBar",
                color: "#10b981",
                shape: "square",
                text: `■ +0.50% (50% TP1)`,
                size: 2
              });
              currentSl = bePrice;
              stage = 1;
              if (bar.high >= tp2Price) {
                markers.push({
                  time: bar.time,
                  position: "belowBar",
                  color: "#10b981",
                  shape: "square",
                  text: `■ +0.75% (25% TP2)`,
                  size: 2
                });
                currentSl = protectHalfPrice;
                stage = 2;
                if (bar.high >= tp3Price) {
                  markers.push({
                    time: bar.time,
                    position: "belowBar",
                    color: "#10b981",
                    shape: "square",
                    text: `■ +1.00% (25% TP3)`,
                    size: 2
                  });
                  break;
                }
              }
            }
          } else {
            if (bar.high >= currentSl) {
              const pnl = ((tp.entryPrice - currentSl) / tp.entryPrice) * 100 - 0.04;
              markers.push({
                time: bar.time,
                position: "belowBar",
                color: "#f43f5e",
                shape: "square",
                text: `■ [РОЙ: ${pnl.toFixed(2)}%] (Stop Loss)`,
                size: 2
              });
              break;
            } else if (bar.low <= tp1Price) {
              markers.push({
                time: bar.time,
                position: "belowBar",
                color: "#10b981",
                shape: "square",
                text: `■ +0.50% (50% TP1)`,
                size: 2
              });
              currentSl = bePrice;
              stage = 1;
              if (bar.low <= tp2Price) {
                markers.push({
                  time: bar.time,
                  position: "belowBar",
                  color: "#10b981",
                  shape: "square",
                  text: `■ +0.75% (25% TP2)`,
                  size: 2
                });
                currentSl = protectHalfPrice;
                stage = 2;
                if (bar.low <= tp3Price) {
                  markers.push({
                    time: bar.time,
                    position: "belowBar",
                    color: "#10b981",
                    shape: "square",
                    text: `■ +1.00% (25% TP3)`,
                    size: 2
                  });
                  break;
                }
              }
            }
          }
        } else if (stage === 1) {
          if (isLong) {
            if (bar.low <= currentSl) {
              markers.push({
                time: bar.time,
                position: "belowBar",
                color: "#eab308",
                shape: "square",
                text: `■ [РОЙ: +0.00%] (Б/У Стоп 50%)`,
                size: 2
              });
              break;
            } else if (bar.high >= tp2Price) {
              markers.push({
                time: bar.time,
                position: "belowBar",
                color: "#10b981",
                shape: "square",
                text: `■ +0.75% (25% TP2)`,
                size: 2
              });
              currentSl = protectHalfPrice;
              stage = 2;
              if (bar.high >= tp3Price) {
                markers.push({
                  time: bar.time,
                  position: "belowBar",
                  color: "#10b981",
                  shape: "square",
                  text: `■ +1.00% (25% TP3)`,
                  size: 2
                });
                break;
              }
            }
          } else {
            if (bar.high >= currentSl) {
              markers.push({
                time: bar.time,
                position: "belowBar",
                color: "#eab308",
                shape: "square",
                text: `■ [РОЙ: +0.00%] (Б/У Стоп 50%)`,
                size: 2
              });
              break;
            } else if (bar.low <= tp2Price) {
              markers.push({
                time: bar.time,
                position: "belowBar",
                color: "#10b981",
                shape: "square",
                text: `■ +0.75% (25% TP2)`,
                size: 2
              });
              currentSl = protectHalfPrice;
              stage = 2;
              if (bar.low <= tp3Price) {
                markers.push({
                  time: bar.time,
                  position: "belowBar",
                  color: "#10b981",
                  shape: "square",
                  text: `■ +1.00% (25% TP3)`,
                  size: 2
                });
                break;
              }
            }
          }
        } else if (stage === 2) {
          if (isLong) {
            if (bar.low <= currentSl) {
              markers.push({
                time: bar.time,
                position: "belowBar",
                color: "#10b981",
                shape: "square",
                text: `■ [РОЙ: +0.50%] (Стоп +0.5% 25%)`,
                size: 2
              });
              break;
            } else if (bar.high >= tp3Price) {
              markers.push({
                time: bar.time,
                position: "belowBar",
                color: "#10b981",
                shape: "square",
                text: `■ +1.00% (25% TP3)`,
                size: 2
              });
              break;
            }
          } else {
            if (bar.high >= currentSl) {
              markers.push({
                time: bar.time,
                position: "belowBar",
                color: "#10b981",
                shape: "square",
                text: `■ [РОЙ: +0.50%] (Стоп +0.5% 25%)`,
                size: 2
              });
              break;
            } else if (bar.low <= tp3Price) {
              markers.push({
                time: bar.time,
                position: "belowBar",
                color: "#10b981",
                shape: "square",
                text: `■ +1.00% (25% TP3)`,
                size: 2
              });
              break;
            }
          }
        }
      }
    });

  } else {

  // ════════════════════════════════════════════════════════════
  // 2. MEAN REVERSION (СДЕЛКИ ИЗ TRADES.CSV И LIVE)
  // ════════════════════════════════════════════════════════════
  let latestTradeTime = 0;

  // 1. Отображение сделок из trades.csv (включая сделку 22 сентября 14:45 -> 19:30 Киев)
  if (historicalTrades.length > 0) {
    for (const t of historicalTrades) {
      if (t.exitTime < minTime) continue; // старше видимой истории

      const entryBarTime = findCandleTime(t.entryTime);
      if (entryBarTime && entryBarTime >= minTime && entryBarTime <= maxTime) {
        const estProb = Math.min(92, Math.max(72, Math.round(76 + (t.pnlPct > 0 ? 8 : -2))));
        markers.push({
          time: entryBarTime,
          position: t.dir === "LONG" ? "belowBar" : "aboveBar",
          color: t.dir === "LONG" ? "#10b981" : "#f43f5e",
          shape: t.dir === "LONG" ? "arrowUp" : "arrowDown",
          text: `${t.dir === "LONG" ? "W" : "R"} ${estProb}%`,
          size: 2
        });
      }

      const exitBarTime = findCandleTime(t.exitTime);
      if (exitBarTime && exitBarTime >= minTime && exitBarTime <= maxTime) {
        const sign = t.pnlPct >= 0 ? "+" : "";
        markers.push({
          time: exitBarTime,
          position: "belowBar",
          color: t.pnlPct >= 0 ? "#10b981" : "#f43f5e",
          shape: "square",
          text: `■ [РОЙ: ${sign}${t.pnlPct.toFixed(2)}%] (${t.reason})`,
          size: 2
        });
      }

      if (t.exitTime > latestTradeTime) {
        latestTradeTime = t.exitTime;
      }
    }
  }

  // 2. Симуляция / отслеживание сигналов для свечей после последней сделки в trades.csv
  const armWindow = 12;
  const feePct = 0.04;

  let pos = null;
  let startIdx = 25;
  if (latestTradeTime > 0) {
    const afterIdx = data.findIndex(d => d.time > latestTradeTime);
    if (afterIdx !== -1) startIdx = Math.max(25, afterIdx);
  }

  for (let i = startIdx; i < data.length; i++) {
    const cur = data[i];
    const prev = data[i - 1];

    if (pos !== null) {
      pos.barsHeld++;

      if (pos.stage === 0) {
        if (pos.dir === "LONG") {
          if (cur.low <= pos.currentSl) {
            const pnl = ((pos.currentSl - pos.entry) / pos.entry) * 100 - feePct;
            markers.push({
              time: cur.time,
              position: "belowBar",
              color: "#f43f5e",
              shape: "square",
              text: `■ [РОЙ: ${pnl.toFixed(2)}%] (Stop Loss)`,
              size: 2
            });
            pos = null;
          } else if (cur.high >= pos.tp1) {
            markers.push({
              time: cur.time,
              position: "belowBar",
              color: "#10b981",
              shape: "square",
              text: `■ +0.50% (50% TP1)`,
              size: 2
            });
            pos.currentSl = pos.beLevel;
            pos.stage = 1;
          }
        } else {
          if (cur.high >= pos.currentSl) {
            const pnl = ((pos.entry - pos.currentSl) / pos.entry) * 100 - feePct;
            markers.push({
              time: cur.time,
              position: "belowBar",
              color: "#f43f5e",
              shape: "square",
              text: `■ [РОЙ: ${pnl.toFixed(2)}%] (Stop Loss)`,
              size: 2
            });
            pos = null;
          } else if (cur.low <= pos.tp1) {
            markers.push({
              time: cur.time,
              position: "belowBar",
              color: "#10b981",
              shape: "square",
              text: `■ +0.50% (50% TP1)`,
              size: 2
            });
            pos.currentSl = pos.beLevel;
            pos.stage = 1;
          }
        }
      }

      if (pos !== null && pos.stage === 1) {
        if (pos.dir === "LONG") {
          if (cur.low <= pos.currentSl) {
            markers.push({
              time: cur.time,
              position: "belowBar",
              color: "#eab308",
              shape: "square",
              text: `■ [РОЙ: +0.00%] (Б/У Стоп 50%)`,
              size: 2
            });
            pos = null;
          } else if (cur.high >= pos.tp2) {
            markers.push({
              time: cur.time,
              position: "belowBar",
              color: "#10b981",
              shape: "square",
              text: `■ +0.75% (25% TP2)`,
              size: 2
            });
            pos.currentSl = pos.protectHalf;
            pos.stage = 2;
          }
        } else {
          if (cur.high >= pos.currentSl) {
            markers.push({
              time: cur.time,
              position: "belowBar",
              color: "#eab308",
              shape: "square",
              text: `■ [РОЙ: +0.00%] (Б/У Стоп 50%)`,
              size: 2
            });
            pos = null;
          } else if (cur.low <= pos.tp2) {
            markers.push({
              time: cur.time,
              position: "belowBar",
              color: "#10b981",
              shape: "square",
              text: `■ +0.75% (25% TP2)`,
              size: 2
            });
            pos.currentSl = pos.protectHalf;
            pos.stage = 2;
          }
        }
      }

      if (pos !== null && pos.stage === 2) {
        if (pos.dir === "LONG") {
          if (cur.low <= pos.currentSl) {
            markers.push({
              time: cur.time,
              position: "belowBar",
              color: "#10b981",
              shape: "square",
              text: `■ [РОЙ: +0.50%] (Стоп +0.5% 25%)`,
              size: 2
            });
            pos = null;
          } else if (cur.high >= pos.tp3) {
            markers.push({
              time: cur.time,
              position: "belowBar",
              color: "#10b981",
              shape: "square",
              text: `■ +1.00% (25% TP3)`,
              size: 2
            });
            pos = null;
          }
        } else {
          if (cur.high >= pos.currentSl) {
            markers.push({
              time: cur.time,
              position: "belowBar",
              color: "#10b981",
              shape: "square",
              text: `■ [РОЙ: +0.50%] (Стоп +0.5% 25%)`,
              size: 2
            });
            pos = null;
          } else if (cur.low <= pos.tp3) {
            markers.push({
              time: cur.time,
              position: "belowBar",
              color: "#10b981",
              shape: "square",
              text: `■ +1.00% (25% TP3)`,
              size: 2
            });
            pos = null;
          }
        }
      }
    }

    if (pos === null) {
      let longArmed = false;
      let shortArmed = false;

      for (let k = 0; k < armWindow && (i - k) >= 0; k++) {
        const bar = data[i - k];
        if (bar.bbLower <= bar.vwapL2 && bar.smiTsi < 0 && bar.ao < 0 && bar.uo < 40 && bar.lrs < -3.0) {
          longArmed = true;
        }
        if (bar.bbUpper >= bar.vwapU2 && bar.smiTsi > 0 && bar.ao > 0 && bar.uo > 60 && bar.lrs > 3.0) {
          shortArmed = true;
        }
      }

      const longAoTurn = cur.aoColor === 1 && prev.aoColor === -1;
      const longSmiTurn = cur.smiTsi > cur.smiSig && prev.smiTsi <= prev.smiSig;
      const longUoTurn = cur.uo > prev.uo;
      const longLrsTurn = cur.lrs > prev.lrs;
      const longTrigger = ((longAoTurn ? 1 : 0) + (longSmiTurn ? 1 : 0) + (longUoTurn ? 1 : 0) + (longLrsTurn ? 1 : 0)) >= 3;

      const shortAoTurn = cur.aoColor === -1 && prev.aoColor === 1;
      const shortSmiTurn = cur.smiTsi < cur.smiSig && prev.smiTsi >= prev.smiSig;
      const shortUoTurn = cur.uo < prev.uo;
      const shortLrsTurn = cur.lrs < prev.lrs;
      const shortTrigger = ((shortAoTurn ? 1 : 0) + (shortSmiTurn ? 1 : 0) + (shortUoTurn ? 1 : 0) + (shortLrsTurn ? 1 : 0)) >= 3;

      if (longArmed && longTrigger) {
        if (isDeathZone(cur.time)) continue; // В зоне смерти (Пт 12:00 — Пн 12:00 Киев/МСК) прогнозы не делаем
        const entryPrice = cur.close;
        pos = {
          dir: "LONG",
          entry: entryPrice,
          time: cur.time,
          barsHeld: 0,
          currentSl: entryPrice * 0.990,
          tp1: entryPrice * 1.005,
          tp2: entryPrice * 1.0075,
          tp3: entryPrice * 1.010,
          beLevel: entryPrice * 1.0004,
          protectHalf: entryPrice * 1.005,
          stage: 0
        };
        const mrProb = calculateMeanReversionProbability(cur, prev);
        markers.push({
          time: cur.time,
          position: "belowBar",
          color: "#10b981",
          shape: "arrowUp",
          text: `W ${mrProb}%`,
          size: 2
        });
      } else if (shortArmed && shortTrigger) {
        if (isDeathZone(cur.time)) continue; // В зоне смерти (Пт 12:00 — Пн 12:00 Киев/МСК) прогнозы не делаем
        const entryPrice = cur.close;
        pos = {
          dir: "SHORT",
          entry: entryPrice,
          time: cur.time,
          barsHeld: 0,
          currentSl: entryPrice * 1.0075,
          tp1: entryPrice * 0.995,
          tp2: entryPrice * 0.9925,
          tp3: entryPrice * 0.990,
          beLevel: entryPrice * 0.9996,
          protectHalf: entryPrice * 0.995,
          stage: 0
        };
        const mrProb = calculateMeanReversionProbability(cur, prev);
        markers.push({
          time: cur.time,
          position: "aboveBar",
          color: "#f43f5e",
          shape: "arrowDown",
          text: `R ${mrProb}%`,
          size: 2
        });
      }
    }
  }

  // Обновление баннера активной позиции
  if (pos !== null) {
    const lastBar = data[data.length - 1];
    const livePnlPct = (((lastBar.close - pos.entry) / pos.entry) * (pos.dir === "LONG" ? 1 : -1) * 100) - feePct;
    const sign = livePnlPct >= 0 ? "+" : "";

    const stateText = document.getElementById("strategy-state-text");
    const subText = document.getElementById("strategy-sub-text");
    if (stateText && subText) {
      stateText.textContent = `В ПОЗИЦИИ: ${pos.dir}`;
      stateText.className = pos.dir === "LONG" ? "status-state text-green" : "status-state text-red";
      const stageTxt = pos.stage === 0 ? " (цель TP1: +0.50%)" : pos.stage === 1 ? " (TP1 взят, цель TP2: +0.75%)" : " (TP2 взят, цель TP3: +1.00%)";
      subText.textContent = `Вход: $${pos.entry.toFixed(2)} | PnL: ${sign}${livePnlPct.toFixed(2)}%${stageTxt}`;
    }
  }
  }

  // Сортировка маркеров по времени
  markers.sort((a, b) => a.time - b.time);
  candleSeries.setMarkers(markers);
}

// ============================================================
// 6. ЗАГРУЗКА ИСТОРИИ И ПОДКЛЮЧЕНИЕ WEBSOCKET
// ============================================================

async function fetchHistoricalData() {
  try {
    // 1. Загрузка подтвержденных сделок
    await loadTradesCsv();

    // 2. Загрузка 1000 свечей 15m (10+ дней)
    const url = `${CONFIG.restUrl}?symbol=${CONFIG.symbol}&interval=${CONFIG.timeframe}&limit=${CONFIG.limit}`;
    const resp = await fetch(url);
    const raw = await resp.json();

    klinesData = raw.map(k => {
      const vol = parseFloat(k[5]);
      const takerBuy = parseFloat(k[9] || (vol * 0.5));
      return {
        time: Math.floor(k[0] / 1000),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: vol,
        takerBuy: takerBuy,
        delta: 2.0 * takerBuy - vol
      };
    });

    // Расчет индикаторов
    calculateIndicators(klinesData);
    wsbCurrentState = calculateWSBOrderFlow(klinesData);

    // Отрисовка
    initChart();
    updateChartSeries(klinesData);
    if (isMarkersVisible) {
      updateTradeMarkers(klinesData);
    }

    if (wsbCurrentState) {
      updateWSBBoxLines(wsbCurrentState.activeBox);
    }

    // Обновление метрик по последней свече
    const last = klinesData[klinesData.length - 1];
    updatePriceHero(last.close);
    updateDecisionMetrics(last);

    if (wsbCurrentState) {
      updateWSBUI(wsbCurrentState, last);
    }

    // Загрузка 24ч статистики
    fetchTicker24h();

    // Запуск WebSocket
    connectWebSocket();

  } catch (err) {
    console.error("Ошибка загрузки данных:", err);
    document.getElementById("chart-loader").innerHTML = `
      <span style="color: #f43f5e;">Ошибка подключения к Binance API</span>
      <button id="chart-retry-btn" class="chart-ctrl-btn" style="margin-top: 10px;">Повторить</button>
    `;
    const retryBtn = document.getElementById("chart-retry-btn");
    if (retryBtn) retryBtn.addEventListener("click", fetchHistoricalData);
  }
}

async function fetchTicker24h() {
  try {
    const resp = await fetch(`${CONFIG.tickerUrl}?symbol=${CONFIG.symbol}`);
    const data = await resp.json();

    const priceChg = parseFloat(data.priceChange);
    const priceChgPct = parseFloat(data.priceChangePercent);
    const high = parseFloat(data.highPrice);
    const low = parseFloat(data.lowPrice);

    const chgBadge = document.getElementById("price-change-badge");
    const sign = priceChg >= 0 ? "+" : "";

    chgBadge.textContent = `${sign}${priceChgPct.toFixed(2)}%`;
    chgBadge.className = `price-badge ${priceChg >= 0 ? "badge-up" : "badge-down"}`;

    document.getElementById("stat-24h-chg").textContent = `${sign}$${priceChg.toFixed(2)}`;
    document.getElementById("stat-24h-high").textContent = `$${high.toFixed(2)}`;
    document.getElementById("stat-24h-low").textContent = `$${low.toFixed(2)}`;
  } catch (e) {
    console.warn("24h ticker fetch error:", e);
  }
}

let lastPrice = null;

function updatePriceHero(price) {
  const priceEl = document.getElementById("live-price");
  if (!priceEl) return;

  priceEl.textContent = `$${price.toFixed(2)}`;

  if (lastPrice !== null) {
    if (price > lastPrice) {
      priceEl.className = "current-price price-up";
    } else if (price < lastPrice) {
      priceEl.className = "current-price price-down";
    }
  }
  lastPrice = price;
}

let lastDataReceivedAt = Date.now();
let watchdogTimer = null;
const WATCHDOG_TIMEOUT_MS = 30000; // 30 секунд

async function refreshKlinesViaRest() {
  try {
    const url = `${CONFIG.restUrl}?symbol=${CONFIG.symbol}&interval=${CONFIG.timeframe}&limit=${CONFIG.limit}`;
    const resp = await fetch(url);
    const raw = await resp.json();

    klinesData = raw.map(k => {
      const vol = parseFloat(k[5]);
      const takerBuy = parseFloat(k[9] || (vol * 0.5));
      return {
        time: Math.floor(k[0] / 1000),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: vol,
        takerBuy: takerBuy,
        delta: 2.0 * takerBuy - vol
      };
    });

    calculateIndicators(klinesData);
    wsbCurrentState = calculateWSBOrderFlow(klinesData);
    updateChartSeries(klinesData);

    const last = klinesData[klinesData.length - 1];
    updatePriceHero(last.close);
    updateDecisionMetrics(last);

    if (wsbCurrentState) {
      updateWSBUI(wsbCurrentState, last);
      updateWSBBoxLines(wsbCurrentState.activeBox);
    }

    lastDataReceivedAt = Date.now();
    console.log("[WATCHDOG REST FALLBACK] Данные успешно обновлены через REST API!");
  } catch (err) {
    console.warn("[WATCHDOG REST ERROR]", err);
  }
}

function startWatchdog() {
  if (watchdogTimer) clearInterval(watchdogTimer);

  watchdogTimer = setInterval(() => {
    const elapsed = Date.now() - lastDataReceivedAt;
    const wsStatus = document.getElementById("ws-status");

    if (elapsed > WATCHDOG_TIMEOUT_MS) {
      console.warn(`[WATCHDOG] 30 сек без обновления (${(elapsed / 1000).toFixed(0)}с). Перезапуск сокета и подгрузка REST...`);
      if (wsStatus) {
        wsStatus.className = "ws-status-pill warning";
        wsStatus.querySelector(".ws-text").textContent = `WATCHDOG RESET (30s)`;
      }

      // 1. Немедленно подтягиваем свежие данные через REST
      refreshKlinesViaRest();
      fetchTicker24h();

      // 2. Сбрасываем и переподключаем WebSocket
      if (ws) {
        try {
          ws.onclose = null;
          ws.onerror = null;
          ws.close();
        } catch (e) {}
        ws = null;
      }
      lastDataReceivedAt = Date.now();
      setTimeout(connectWebSocket, 1000);

    } else if (ws && ws.readyState === WebSocket.OPEN) {
      if (wsStatus && wsStatus.textContent !== "STREAM LIVE") {
        wsStatus.className = "ws-status-pill online";
        wsStatus.querySelector(".ws-text").textContent = "STREAM LIVE";
      }
    }
  }, 3000); // Проверка каждые 3 секунды
}

function connectWebSocket() {
  const wsStatus = document.getElementById("ws-status");

  try {
    if (ws) {
      try { ws.close(); } catch(e) {}
      ws = null;
    }

    ws = new WebSocket(CONFIG.wsUrl);

    ws.onopen = () => {
      lastDataReceivedAt = Date.now();
      if (wsStatus) {
        wsStatus.className = "ws-status-pill online";
        wsStatus.querySelector(".ws-text").textContent = "STREAM LIVE";
      }
      console.log("[WS] Подключено к Binance Futures WebSocket!");
    };

    ws.onmessage = (event) => {
      lastDataReceivedAt = Date.now(); // Сброс таймера ватчдога

      const msg = JSON.parse(event.data);
      const k = msg.k;
      if (!k) return;

      const vol = parseFloat(k.v);
      const takerBuy = parseFloat(k.V || (vol * 0.5));
      const candle = {
        time: Math.floor(k.t / 1000),
        open: parseFloat(k.o),
        high: parseFloat(k.h),
        low: parseFloat(k.l),
        close: parseFloat(k.c),
        volume: vol,
        takerBuy: takerBuy,
        delta: 2.0 * takerBuy - vol,
        isClosed: k.x
      };

      // 1. Обновляем тикер в реальном времени
      updatePriceHero(candle.close);

      // 2. Обновляем текущую формирующуюся свечу в массиве
      if (klinesData.length > 0) {
        const lastIdx = klinesData.length - 1;
        if (klinesData[lastIdx].time === candle.time) {
          klinesData[lastIdx] = candle;
        } else {
          klinesData.push(candle);
        }

        // Пересчет индикаторов
        calculateIndicators(klinesData);
        wsbCurrentState = calculateWSBOrderFlow(klinesData);

        // Обновление графика на тике
        const curLast = klinesData[klinesData.length - 1];
        candleSeries.update({
          time: curLast.time,
          open: curLast.open,
          high: curLast.high,
          low: curLast.low,
          close: curLast.close
        });

        if (curLast.vwap && isVwapVisible) {
          vwapMidSeries.update({ time: curLast.time, value: curLast.vwap });
          vwapUpper1Series.update({ time: curLast.time, value: curLast.vwapU1 });
          vwapLower1Series.update({ time: curLast.time, value: curLast.vwapL1 });
          vwapUpper2Series.update({ time: curLast.time, value: curLast.vwapU2 });
          vwapLower2Series.update({ time: curLast.time, value: curLast.vwapL2 });
        }

        if (curLast.bbUpper && isBbVisible) {
          bbUpperSeries.update({ time: curLast.time, value: curLast.bbUpper });
          bbMidSeries.update({ time: curLast.time, value: curLast.bbMid });
          bbLowerSeries.update({ time: curLast.time, value: curLast.bbLower });
        }

        updateDecisionMetrics(curLast);

        if (wsbCurrentState) {
          updateWSBUI(wsbCurrentState, curLast);
          updateWSBBoxLines(wsbCurrentState.activeBox);
        }

        if (!isCrosshairHovering) {
          updateDualTimeDisplay(null);
        }

        // 3. Проверка сигнала при закрытии свечи
        if (candle.isClosed) {
          if (!isDeathZone(curLast.time)) {
            checkForSignals(klinesData);
            if (wsbCurrentState && wsbCurrentState.activeBox && wsbCurrentState.activeBox.breakoutOccurred) {
              const b = wsbCurrentState.activeBox;
              const prob = b.probability || calculateBreakoutProbability(b, curLast, klinesData);
              const dirCode = b.breakoutDir === "LONG" ? "W" : "R";
              triggerSignalAlert(`⚡ WSB ${dirCode} ПРОБОЙ (${prob}%)!`, `Вход: $${curLast.close.toFixed(2)} | Вероятность: ${prob}% | δ-ratio: ${wsbCurrentState.deltaRatio.toFixed(2)} | SL: $${wsbCurrentState.calcSl.toFixed(2)}`);
            }
          }
          if (isMarkersVisible) {
            updateTradeMarkers(klinesData);
          }
        }
      }
    };

    ws.onerror = (e) => {
      console.warn("WebSocket error:", e);
      if (wsStatus) {
        wsStatus.className = "ws-status-pill warning";
        wsStatus.querySelector(".ws-text").textContent = "WS ERROR";
      }
    };

    ws.onclose = () => {
      if (wsStatus) {
        wsStatus.className = "ws-status-pill";
        wsStatus.querySelector(".ws-text").textContent = "RECONNECTING";
      }
      setTimeout(connectWebSocket, 3000);
    };

  } catch (err) {
    console.error("WS connect failed:", err);
    setTimeout(connectWebSocket, 4000);
  }
}

// ============================================================
// 7. ОБРАБОТКА СИГНАЛОВ И ВСПЛЫВАЮЩИЕ УВЕДОМЛЕНИЯ
// ============================================================

function checkForSignals(data) {
  if (data.length < 5) return;
  const cur = data[data.length - 1];
  if (isDeathZone(cur.time)) return; // В зоне смерти (Пт 12:00 — Пн 12:00 Киев/МСК) прогнозы не делаем
  const prev = data[data.length - 2];

  // Зона взвода
  const isLongArm = (cur.bbLower <= cur.vwapL2) && (cur.smiTsi < 0) && (cur.ao < 0) && (cur.uo < 40) && (cur.lrs < -3.0);
  const isShortArm = (cur.bbUpper >= cur.vwapU2) && (cur.smiTsi > 0) && (cur.ao > 0) && (cur.uo > 60) && (cur.lrs > 3.0);

  // Разворотный триггер
  const longTurn = (cur.aoColor === 1 && prev.aoColor === -1) || (cur.smiTsi > cur.smiSig && prev.smiTsi <= prev.smiSig);
  const shortTurn = (cur.aoColor === -1 && prev.aoColor === 1) || (cur.smiTsi < cur.smiSig && prev.smiTsi >= prev.smiSig);

  if (isLongArm && longTurn && lastSignalTime !== cur.time) {
    lastSignalTime = cur.time;
    const mrProb = calculateMeanReversionProbability(cur, prev);
    triggerSignalAlert(`🟢 СИГНАЛ В ЛОНГ W (${mrProb}%)`, `Цена: $${cur.close.toFixed(2)} | Вероятность: ${mrProb}% | TP: +0.5% (50%), +0.75% (25%), +1.0% (25%)`);
  } else if (isShortArm && shortTurn && lastSignalTime !== cur.time) {
    lastSignalTime = cur.time;
    const mrProb = calculateMeanReversionProbability(cur, prev);
    triggerSignalAlert(`🔴 СИГНАЛ В ШОРТ R (${mrProb}%)`, `Цена: $${cur.close.toFixed(2)} | Вероятность: ${mrProb}% | TP: +0.5% (50%), +0.75% (25%), +1.0% (25%)`);
  }
}

function triggerSignalAlert(title, text) {
  // Тройной звук
  if (isAlertEnabled) {
    playTripleAlertSound();
  }

  // Toast
  showToast(title, text);
}

function showToast(title, msg) {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `
    <div class="toast-title">${title}</div>
    <div class="toast-msg">${msg}</div>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(-10px)";
    setTimeout(() => toast.remove(), 400);
  }, 7000);
}

// ============================================================
// 8. ИНИЦИАЛИЗАЦИЯ И СЛУШАТЕЛИ СОБЫТИЙ
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  // Запуск часов
  updateWorldClocks();
  setInterval(updateWorldClocks, 1000);

  // Колокольчик
  const bellBtn = document.getElementById("alert-bell-btn");
  bellBtn.addEventListener("click", () => {
    isAlertEnabled = !isAlertEnabled;
    if (isAlertEnabled) {
      bellBtn.classList.add("active");
      bellBtn.querySelector(".bell-text").textContent = "АЛЕРТ ВКЛ";
      playTripleAlertSound();
      showToast("🔔 Алерт активирован", "Тройной звуковой сигнал включен при новых точках входа.");
    } else {
      bellBtn.classList.remove("active");
      bellBtn.querySelector(".bell-text").textContent = "АЛЕРТ ВЫКЛ";
      showToast("🔕 Алерт выключен", "Звуковые уведомления приостановлены.");
    }
  });

  // Кнопка теста звука
  document.getElementById("test-sound-btn").addEventListener("click", () => {
    playTripleAlertSound();
    showToast("🔊 Тест звука", "Воспроизведен тройной короткий сигнал алерта.");
  });

  // Переключатели графика
  const btnMarkers = document.getElementById("btn-toggle-markers");
  if (btnMarkers) {
    btnMarkers.addEventListener("click", (e) => {
      isMarkersVisible = !isMarkersVisible;
      e.target.classList.toggle("active", isMarkersVisible);
      if (!isMarkersVisible) {
        candleSeries.setMarkers([]);
      } else {
        updateTradeMarkers(klinesData);
      }
    });
  }

  document.getElementById("btn-toggle-vwap").addEventListener("click", (e) => {
    isVwapVisible = !isVwapVisible;
    e.target.classList.toggle("active", isVwapVisible);
    if (!isVwapVisible) {
      vwapMidSeries.setData([]);
      vwapUpper1Series.setData([]);
      vwapLower1Series.setData([]);
      vwapUpper2Series.setData([]);
      vwapLower2Series.setData([]);
    } else {
      updateChartSeries(klinesData);
    }
  });

  document.getElementById("btn-toggle-bb").addEventListener("click", (e) => {
    isBbVisible = !isBbVisible;
    e.target.classList.toggle("active", isBbVisible);
    if (!isBbVisible) {
      bbUpperSeries.setData([]);
      bbMidSeries.setData([]);
      bbLowerSeries.setData([]);
    } else {
      updateChartSeries(klinesData);
    }
  });

  // Переключатель стратегий WSB vs Mean Reversion
  const btnStratWsb = document.getElementById("btn-strat-wsb");
  const btnStratMeanRev = document.getElementById("btn-strat-meanrev");
  const panelWsb = document.getElementById("wsb-indicators-panel");
  const panelMeanRev = document.getElementById("meanrev-indicators-panel");

  if (btnStratWsb && btnStratMeanRev) {
    btnStratWsb.addEventListener("click", () => {
      activeStrategy = "wsb";
      btnStratWsb.classList.add("active");
      btnStratMeanRev.classList.remove("active");
      if (panelWsb) panelWsb.style.display = "flex";
      if (panelMeanRev) panelMeanRev.style.display = "none";
      if (wsbCurrentState && klinesData.length > 0) {
        updateWSBUI(wsbCurrentState, klinesData[klinesData.length - 1]);
        updateWSBBoxLines(wsbCurrentState.activeBox);
      }
      if (isMarkersVisible) updateTradeMarkers(klinesData);
    });

    btnStratMeanRev.addEventListener("click", () => {
      activeStrategy = "meanrev";
      btnStratMeanRev.classList.add("active");
      btnStratWsb.classList.remove("active");
      if (panelWsb) panelWsb.style.display = "none";
      if (panelMeanRev) panelMeanRev.style.display = "flex";
      if (klinesData.length > 0) {
        updateDecisionMetrics(klinesData[klinesData.length - 1]);
      }
      if (isMarkersVisible) updateTradeMarkers(klinesData);
    });
  }

  // Переключатель отображения линий WSB Бокса на графике
  const btnToggleWsbBox = document.getElementById("btn-toggle-wsb-box");
  if (btnToggleWsbBox) {
    btnToggleWsbBox.addEventListener("click", () => {
      isWsbBoxVisible = !isWsbBoxVisible;
      btnToggleWsbBox.classList.toggle("active", isWsbBoxVisible);
      if (wsbCurrentState) {
        updateWSBBoxLines(wsbCurrentState.activeBox);
      }
    });
  }

  document.getElementById("btn-reset-view").addEventListener("click", () => {
    if (chart) chart.timeScale().fitContent();
  });

  // Запуск начальной загрузки данных
  fetchHistoricalData();

  // Запуск 30-секундного ватчдога потока
  startWatchdog();

  // Фоновый пульс обновления 24ч тикера каждые 10 секунд
  setInterval(fetchTicker24h, 10000);
});
