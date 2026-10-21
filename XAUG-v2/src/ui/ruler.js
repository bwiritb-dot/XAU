import { C, num, signed } from "./parts.js";

export function renderRuler({ trade, price, width = 600 }) {
  if (!trade) return `<div class="ruler empty"></div>`;
  const { sig, state } = trade;
  const lv = state.levels;
  const L = sig.dir === "LONG";
  const pts = [
    { p: lv.sl, color: C.short, done: false },
    { p: lv.entry, color: "#e2e8f0", done: true },
    { p: lv.tp1, color: C.long, done: state.stage >= 1 },
    { p: lv.tp2, color: C.long, done: state.stage >= 2 },
    { p: lv.tp3, color: C.long, done: false },
  ];
  const all = [...pts.map((x) => x.p), price].filter((v) => Number.isFinite(v));
  const lo = Math.min(...all), hi = Math.max(...all), W = Math.max(200, width);
  const X = (p) => (hi > lo ? ((p - lo) / (hi - lo)) * W : W / 2);
  const pctOf = (p) => ((L ? p - lv.entry : lv.entry - p) / lv.entry) * 100;
  const marks = pts.map((x) => `
    <line x1="${X(x.p)}" y1="18" x2="${X(x.p)}" y2="38" stroke="${x.color}" stroke-width="3"/>
    <circle cx="${X(x.p)}" cy="28" r="5" fill="${x.done ? x.color : "#0b0f17"}" stroke="${x.color}" stroke-width="2"/>
    <text x="${X(x.p)}" y="12" fill="${x.color}" font-size="11" text-anchor="middle">${num(x.p, 2)}</text>
    <text x="${X(x.p)}" y="52" fill="${x.color}" font-size="11" text-anchor="middle">${signed(pctOf(x.p), 2)}</text>`).join("");
  const moved = state.stage > 0
    ? `<line x1="${X(state.sl)}" y1="16" x2="${X(state.sl)}" y2="40" stroke="${C.short}" stroke-width="2" stroke-dasharray="3 3"/>`
    : "";
  const now = Number.isFinite(price) ? `<polygon points="${X(price) - 6},44 ${X(price) + 6},44 ${X(price)},34" fill="${C.gold}"/>` : "";
  return `<div class="ruler" style="--c:${L ? C.long : C.short}">
    <span class="dir">${L ? "▲" : "▼"}</span>
    <svg viewBox="-30 0 ${W + 60} 56" width="${W + 60}" height="56"><line x1="0" y1="28" x2="${W}" y2="28" stroke="#334155" stroke-width="2"/>${marks}${moved}${now}</svg>
  </div>`;
}
