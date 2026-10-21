import { ICON } from "./icons.js";

export const C = { long: "#10b981", short: "#f43f5e", off: "#64748b", gold: "#f59e0b" };

export const num = (v, d = 2) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "");
export const signed = (v, d = 2) => (typeof v === "number" && Number.isFinite(v) ? (v >= 0 ? "+" : "") + v.toFixed(d) : "");

// Значение фактора рядом со шкалой — только числа.
function factorValue(f) {
  switch (f.key) {
    case "wicks": return `${f.value}/5`;
    case "delta": return signed(f.value, 2);
    case "dirMatch": return f.value ? "=" : "≠";
    case "z": return signed(f.value, 1);
    case "vwap": return signed(f.value, 1);
    case "impulse": return num(f.value, 2);
    case "smi": return signed(f.value, 0);
    case "uo": return num(f.value, 0);
    case "aoFlip": return f.pts ? "⇅" : "·";
    case "lrs": return signed(f.value, 1);
    default: return "";
  }
}

// Полоса 0–100: база серым, заработанные баллы цветом, вне [min, max] — штриховка (зажим).
export function scoreBlock(score, color) {
  const pct = (v) => Math.max(0, Math.min(100, v));
  let x = 0;
  const seg = (w, fill, extra = "") => {
    const r = `<rect x="${pct(x)}" y="0" width="${Math.max(0, pct(x + w) - pct(x))}" height="10" fill="${fill}" ${extra}/>`;
    x += w;
    return r;
  };
  const segs = [seg(score.base, C.off, 'opacity="0.5"'), ...score.factors.filter((f) => f.pts > 0).map((f) => seg(f.pts, color))];
  const [lo, hi] = score.clamp;
  const bar = `<svg class="scorebar" viewBox="0 0 100 10" preserveAspectRatio="none">
    <rect x="0" y="0" width="100" height="10" fill="#1e293b"/>${segs.join("")}
    <rect x="0" y="0" width="${lo}" height="10" fill="url(#hatch)" opacity="0.6"/>
    <rect x="${hi}" y="0" width="${100 - hi}" height="10" fill="url(#hatch)" opacity="0.6"/>
    <line x1="${score.total}" y1="0" x2="${score.total}" y2="10" stroke="#fff" stroke-width="0.8"/>
  </svg>`;
  const unit = 12; // px за балл
  const rows = score.factors.map((f) => {
    const on = f.pts > 0;
    const ticks = (f.steps || []).slice(0, -1).map((s) => `<i class="tick" style="left:${(s / f.max) * 100}%"></i>`).join("");
    return `<div class="row ${on ? "on" : "off"}" style="--c:${on ? color : C.off}">
      <span class="ic">${ICON[f.key] || ""}</span>
      <span class="track" style="width:${f.max * unit}px"><b style="width:${(f.pts / f.max) * 100}%"></b>${ticks}</span>
      <span class="pts">${on ? "+" + f.pts : "0"}</span>
      <span class="val">${factorValue(f)}</span>
    </div>`;
  }).join("");
  return `<div class="score"><div class="total" style="color:${color}">${score.total}</div>${bar}<div class="base">${score.base}</div>${rows}</div>`;
}

// Горизонтальная шкала: пороги цветными засечками, полоса (band) серым, значение — игла.
export function gauge({ min, max, value, ticks = [], band = null }) {
  const W = 160;
  const X = (v) => ((v - min) / (max - min)) * W;
  const ok = (v) => typeof v === "number" && Number.isFinite(v) && max > min;
  const parts = [`<line x1="0" y1="8" x2="${W}" y2="8" stroke="#334155" stroke-width="2"/>`];
  if (band && ok(band[0]) && ok(band[1])) {
    parts.push(`<rect x="${X(Math.max(min, band[0]))}" y="4" width="${Math.max(0, X(Math.min(max, band[1])) - X(Math.max(min, band[0])))}" height="8" fill="${C.off}" opacity="0.6"/>`);
  }
  for (const t of ticks) if (ok(t.v)) parts.push(`<line x1="${X(t.v)}" y1="1" x2="${X(t.v)}" y2="15" stroke="${t.color}" stroke-width="2"/>`);
  if (ok(value)) {
    const v = Math.max(min, Math.min(max, value));
    parts.push(`<polygon class="needle" points="${X(v) - 4},0 ${X(v) + 4},0 ${X(v)},8" fill="#fff"/>`);
  }
  return `<svg class="gauge" viewBox="-4 0 ${W + 8} 16" width="${W + 8}" height="16">${parts.join("")}</svg>`;
}
