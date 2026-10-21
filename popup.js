/**
 * XAUG POPUP CONTROLLER
 */

const SYMBOL = "XAUUSDT";
const TICKER_URL = `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${SYMBOL}`;
const KLINES_URL = `https://fapi.binance.com/fapi/v1/klines?symbol=${SYMBOL}&interval=15m&limit=40`;

document.addEventListener("DOMContentLoaded", () => {
  const btnOpen = document.getElementById("btn-open-terminal");
  if (btnOpen) {
    btnOpen.addEventListener("click", () => {
      if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: "index.html" });
      } else {
        window.open("index.html", "_blank");
      }
    });
  }

  loadQuickData();
  setInterval(loadQuickData, 5000);
});

async function loadQuickData() {
  try {
    // 1. Котировка и 24ч изменение
    const tickerResp = await fetch(TICKER_URL);
    if (tickerResp.ok) {
      const t = await tickerResp.json();
      const lastPrice = parseFloat(t.lastPrice);
      const chgPct = parseFloat(t.priceChangePercent);

      const priceEl = document.getElementById("pop-price");
      const chgEl = document.getElementById("pop-chg");

      if (priceEl) priceEl.textContent = `$${lastPrice.toFixed(2)}`;
      if (chgEl) {
        const sign = chgPct >= 0 ? "+" : "";
        chgEl.textContent = `${sign}${chgPct.toFixed(2)}%`;
        chgEl.className = `pop-chg ${chgPct >= 0 ? "" : "down"}`;
      }
    }

    // 2. Свечи 15m для расчета готовности WSB
    const klinesResp = await fetch(KLINES_URL);
    if (klinesResp.ok) {
      const klines = await klinesResp.json();
      const bars = klines.map(k => {
        const vol = parseFloat(k[5]);
        const takerBuy = parseFloat(k[9] || (vol * 0.5));
        return {
          time: Math.floor(k[0] / 1000),
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: vol,
          delta: 2.0 * takerBuy - vol
        };
      });

      analyzeWSBQuick(bars);
    }
  } catch (err) {
    console.warn("[XAUG Popup] Ошибка обновления данных:", err);
  }
}

function analyzeWSBQuick(bars) {
  if (bars.length < 10) return;
  const last = bars[bars.length - 1];

  // Анализ теней последних 5 свечей
  const last5 = bars.slice(-5);
  let bearWicks = 0;
  let bullWicks = 0;

  last5.forEach(b => {
    const range = b.high - b.low;
    if (range <= 0) return;
    const body = Math.abs(b.close - b.open);
    const upper = b.high - Math.max(b.open, b.close);
    const lower = Math.min(b.open, b.close) - b.low;

    if (upper >= 0.45 * range && upper >= 1.5 * Math.max(body, lower)) bearWicks++;
    if (lower >= 0.45 * range && lower >= 1.5 * Math.max(body, upper)) bullWicks++;
  });

  // Delta Ratio за 10 свечей
  let dSum = 0;
  let vSum = 0;
  bars.slice(-10).forEach(b => {
    dSum += b.delta;
    vSum += b.volume;
  });
  const dr = vSum > 0 ? (dSum / vSum) : 0;

  let longReady = Math.round((bullWicks / 3) * 45);
  let shortReady = Math.round((bearWicks / 3) * 45);

  if (dr > 0.15) longReady += 35;
  else if (dr > 0) longReady += 15;

  if (dr < -0.15) shortReady += 35;
  else if (dr < 0) shortReady += 15;

  longReady = Math.min(95, Math.max(10, longReady));
  shortReady = Math.min(95, Math.max(10, shortReady));

  const longPctEl = document.getElementById("pop-long-pct");
  const longBarEl = document.getElementById("pop-long-bar");
  const shortPctEl = document.getElementById("pop-short-pct");
  const shortBarEl = document.getElementById("pop-short-bar");

  if (longPctEl) longPctEl.textContent = `${longReady}%`;
  if (longBarEl) longBarEl.style.width = `${longReady}%`;

  if (shortPctEl) shortPctEl.textContent = `${shortReady}%`;
  if (shortBarEl) shortBarEl.style.width = `${shortReady}%`;

  const stateTag = document.getElementById("pop-state-tag");
  const stateDesc = document.getElementById("pop-state-desc");

  if (stateTag && stateDesc) {
    if (longReady >= 80) {
      stateTag.textContent = "СИГНАЛ W";
      stateTag.className = "tag green";
      stateDesc.textContent = `Высокая вероятность пробоя вверх (${longReady}%)! δ-ratio: ${dr >= 0 ? "+" : ""}${dr.toFixed(2)}`;
    } else if (shortReady >= 80) {
      stateTag.textContent = "СИГНАЛ R";
      stateTag.className = "tag red";
      stateDesc.textContent = `Высокая вероятность пробоя вниз (${shortReady}%)! δ-ratio: ${dr >= 0 ? "+" : ""}${dr.toFixed(2)}`;
    } else {
      stateTag.textContent = "МОНИТОРИНГ";
      stateTag.className = "tag neutral";
      stateDesc.textContent = `Анализ свечей: бычьих теней: ${bullWicks}/3, медвежьих: ${bearWicks}/3 | δ: ${dr >= 0 ? "+" : ""}${dr.toFixed(2)}`;
    }
  }
}
