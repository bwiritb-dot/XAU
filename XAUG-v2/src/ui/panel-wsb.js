import { ICON } from "./icons.js";
import { C, num, scoreBlock } from "./parts.js";

const hhmm = (t) => {
  const d = new Date((t + 3 * 3600) * 1000); // UTC+3, как зона смерти оригинала
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

function miniCandles(bars) {
  if (bars.length === 0) return "";
  const hi = Math.max(...bars.map((b) => b.high));
  const lo = Math.min(...bars.map((b) => b.low));
  const Y = (p) => (hi > lo ? ((hi - p) / (hi - lo)) * 56 + 2 : 30);
  return bars.map((b) => {
    const wc = b.wickType === "bull_wick" ? C.long : b.wickType === "bear_wick" ? C.short : C.off;
    const top = Math.max(b.open, b.close);
    const bot = Math.min(b.open, b.close);
    return `<svg class="mc" viewBox="0 0 20 60" width="22" height="60">
      <line x1="10" y1="${Y(b.high)}" x2="10" y2="${Y(top)}" stroke="${b.wickType === "bear_wick" ? wc : C.off}" stroke-width="${b.wickType === "bear_wick" ? 3 : 1.5}"/>
      <line x1="10" y1="${Y(bot)}" x2="10" y2="${Y(b.low)}" stroke="${b.wickType === "bull_wick" ? wc : C.off}" stroke-width="${b.wickType === "bull_wick" ? 3 : 1.5}"/>
      <rect x="5" y="${Y(top)}" width="10" height="${Math.max(1, Y(bot) - Y(top))}" fill="${b.close >= b.open ? "#94a3b8" : "#475569"}"/>
    </svg>`;
  }).join("");
}

function boxView(box, close) {
  if (!box || !box.active) return `<div class="boxv empty">${ICON.box}</div>`;
  const color = box.signalDir === "LONG" ? C.long : C.short;
  const hi = Math.max(box.top, close);
  const lo = Math.min(box.bottom, close);
  const pad = (hi - lo) * 0.15 || 1;
  const Y = (p) => ((hi + pad - p) / (hi - lo + 2 * pad)) * 80;
  return `<div class="boxv" style="--c:${color}">
    <svg viewBox="0 0 120 80" width="120" height="80">
      <rect x="10" y="${Y(box.top)}" width="60" height="${Math.max(1, Y(box.bottom) - Y(box.top))}" fill="${color}" opacity="0.18" stroke="${color}"/>
      <circle cx="40" cy="${Y(close)}" r="4" fill="${C.gold}"/>
      <text x="74" y="${Y(box.top) + 4}" fill="${color}" font-size="10">${num(box.top, 2)}</text>
      <text x="74" y="${Y(box.bottom) + 4}" fill="${color}" font-size="10">${num(box.bottom, 2)}</text>
    </svg>
    <div class="dist"><span>↑${num(box.top - close, 2)}</span><span>↓${num(close - box.bottom, 2)}</span></div>
    <div class="age"><b style="width:${Math.min(100, box.age)}%"></b><span>${box.age}/100</span></div>
  </div>`;
}

export function renderWsb({ data, wsb, signal }) {
  const last5 = wsb ? wsb.last5 : data.slice(-5);
  const bull = wsb ? wsb.curBullWicks : 0;
  const bear = wsb ? wsb.curBearWicks : 0;
  const close = data.length ? data[data.length - 1].close : NaN;
  const sigHtml = signal
    ? `<div class="sig" style="color:${signal.dir === "LONG" ? C.long : C.short}">${signal.dir === "LONG" ? "▲" : "▼"} <span>${hhmm(signal.time)}</span> <span>${num(signal.entry, 2)}</span></div>${scoreBlock(signal.explain, signal.dir === "LONG" ? C.long : C.short)}`
    : `<div class="sig empty">—</div>`;
  return `<section class="p wsb">
    <div class="candles">${miniCandles(last5)}</div>
    <div class="counts"><b style="color:${bull >= 3 ? C.long : C.off}">▲${bull}/3</b><b style="color:${bear >= 3 ? C.short : C.off}">▼${bear}/3</b></div>
    ${boxView(wsb ? wsb.activeBox : null, close)}
    ${sigHtml}
  </section>`;
}
