import { CONFIG, calculateIndicators, calculateWSBOrderFlow, computeMarkers } from "./core.js";

// Разбор свечей — как в app.js (fetchHistoricalData / ws.onmessage).
export function mapRestKline(k) {
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
    delta: 2.0 * takerBuy - vol,
  };
}

export function mapWsKline(k) {
  const vol = parseFloat(k.v);
  const takerBuy = parseFloat(k.V || (vol * 0.5));
  return {
    time: Math.floor(k.t / 1000),
    open: parseFloat(k.o),
    high: parseFloat(k.h),
    low: parseFloat(k.l),
    close: parseFloat(k.c),
    volume: vol,
    takerBuy: takerBuy,
    delta: 2.0 * takerBuy - vol,
    isClosed: k.x,
  };
}

export function applyKline(data, candle) {
  if (data.length === 0) return data;
  const lastIdx = data.length - 1;
  if (data[lastIdx].time === candle.time) data[lastIdx] = candle;
  else data.push(candle);
  return data;
}

// Порядок расчёта — как в оригинале: индикаторы → WSB → метки.
export function pipeline(data, strategy) {
  calculateIndicators(data);
  const wsb = calculateWSBOrderFlow(data);
  const markers = computeMarkers(data, strategy, wsb);
  return { data, wsb, markers };
}

export async function fetchKlines() {
  const url = `${CONFIG.restUrl}?symbol=${CONFIG.symbol}&interval=${CONFIG.timeframe}&limit=${CONFIG.limit}`;
  const raw = await (await fetch(url)).json();
  return raw.map(mapRestKline);
}

// Поток свечей: переподключение через 3 с; 30 с тишины → onStale() и пересоздание сокета (как watchdog оригинала).
export function connectStream({ onCandle, onStale, onStatus }) {
  let ws = null;
  let lastAt = Date.now();
  let stopped = false;
  const open = () => {
    ws = new WebSocket(CONFIG.wsUrl);
    ws.onopen = () => { lastAt = Date.now(); onStatus(true); };
    ws.onmessage = (ev) => {
      lastAt = Date.now();
      const msg = JSON.parse(ev.data);
      if (msg.k) onCandle(mapWsKline(msg.k));
    };
    ws.onerror = () => onStatus(false);
    ws.onclose = () => { onStatus(false); if (!stopped) setTimeout(open, 3000); };
  };
  open();
  const timer = setInterval(() => {
    if (Date.now() - lastAt <= 30000) return;
    lastAt = Date.now();
    onStale();
    try { ws.onclose = null; ws.close(); } catch (e) {}
    setTimeout(open, 1000);
  }, 3000);
  return () => { stopped = true; clearInterval(timer); try { ws.close(); } catch (e) {} };
}
