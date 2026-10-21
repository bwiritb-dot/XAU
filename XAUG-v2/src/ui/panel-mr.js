import { ICON } from "./icons.js";
import { C, num, gauge, scoreBlock } from "./parts.js";
import { mrBarState } from "../explain.js";

const fin = (v) => typeof v === "number" && Number.isFinite(v);

function armGauge(key, b) {
  switch (key) {
    case "bb": {
      const vals = [b.vwapL2, b.vwapU2, b.bbLower, b.bbUpper].filter(fin);
      if (vals.length < 4) return gauge({ min: 0, max: 1, value: undefined });
      const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.05;
      return gauge({ min: lo - pad, max: hi + pad, value: b.close, band: [b.bbLower, b.bbUpper],
        ticks: [{ v: b.vwapL2, color: C.long }, { v: b.vwapU2, color: C.short }] });
    }
    case "uo": return gauge({ min: 0, max: 100, value: b.uo, ticks: [{ v: 40, color: C.long }, { v: 60, color: C.short }] });
    case "lrs": { const m = Math.max(6, fin(b.lrs) ? Math.abs(b.lrs) : 0); return gauge({ min: -m, max: m, value: b.lrs, ticks: [{ v: -3, color: C.long }, { v: 3, color: C.short }] }); }
    case "smi": { const m = Math.max(40, fin(b.smiTsi) ? Math.abs(b.smiTsi) : 0); return gauge({ min: -m, max: m, value: b.smiTsi, ticks: [{ v: 0, color: C.off }] }); }
    case "ao": { const m = Math.max(1, fin(b.ao) ? Math.abs(b.ao) * 1.5 : 0); return gauge({ min: -m, max: m, value: b.ao, ticks: [{ v: 0, color: C.off }] }); }
    default: return "";
  }
}

const AO_KEYS = ["aoFlip", "smi", "uo", "lrs"]; // порядок ламп = порядок turns в mrBarState

export function renderMr({ data, signal }) {
  if (data.length < 2) return `<section class="p mr empty">${ICON.wave}</section>`;
  const i = data.length - 1;
  const b = data[i];
  const st = mrBarState(data, i);
  const rows = st.keys.map((key, k) => {
    const color = st.arm.long[k] ? C.long : st.arm.short[k] ? C.short : C.off;
    return `<div class="arm-row"><span class="ic">${ICON[key]}</span>${armGauge(key, b)}<span class="w" style="background:${color}">${st.weights[k]}</span></div>`;
  }).join("");
  const cells = st.win.long.map((l, k) => `<i class="cell ${l ? "l" : st.win.short[k] ? "s" : "o"}"></i>`).join("");
  const lamps = (flags, cls) => flags.map((f, k) => `<i class="lamp ${f ? cls : "o"}">${ICON[AO_KEYS[k]]}</i>`).join("");
  const nL = st.turns.long.filter(Boolean).length;
  const nS = st.turns.short.filter(Boolean).length;
  const sigHtml = signal ? scoreBlock(signal.explain, signal.dir === "LONG" ? C.long : C.short) : `<div class="sig empty">—</div>`;
  return `<section class="p mr">
    ${rows}
    <div class="ready"><b style="color:${C.long}">${st.readyLong}</b><b style="color:${C.short}">${st.readyShort}</b></div>
    <div class="cells">${cells}</div>
    <div class="lamps"><span>${lamps(st.turns.long, "l")}</span><b style="color:${nL >= 3 ? C.long : C.off}">${nL}/3</b></div>
    <div class="lamps"><span>${lamps(st.turns.short, "s")}</span><b style="color:${nS >= 3 ? C.short : C.off}">${nS}/3</b></div>
    ${sigHtml}
  </section>`;
}
