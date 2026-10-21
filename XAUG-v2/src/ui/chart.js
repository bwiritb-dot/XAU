import { toWordless } from "../wordless.js";

export function createChart(el) {
  const chart = LightweightCharts.createChart(el, {
    autoSize: true,
    layout: { background: { color: "#0b0f17" }, textColor: "#94a3b8" },
    grid: { vertLines: { color: "#111827" }, horzLines: { color: "#111827" } },
    timeScale: {
      timeVisible: true, secondsVisible: false, borderVisible: false,
      tickMarkFormatter: (t) => {
        const d = new Date(t * 1000);
        const p = (n) => String(n).padStart(2, "0");
        return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 ? `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}` : `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
      },
    },
    rightPriceScale: { borderVisible: false },
    // Ось времени без названий месяцев: только числа.
    localization: { dateFormat: "dd.MM.yy" },
  });
  const candles = chart.addCandlestickSeries({
    upColor: "#10b981", downColor: "#f43f5e", wickUpColor: "#10b981", wickDownColor: "#f43f5e", borderVisible: false,
  });
  const line = (color, lineStyle = 0) => chart.addLineSeries({ color, lineWidth: 1, lineStyle, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
  const lines = { vwap: line("#f59e0b"), vwapU2: line("#f43f5e", 2), vwapL2: line("#10b981", 2), bbUpper: line("#64748b"), bbLower: line("#64748b") };
  return { chart, candles, lines };
}

// Линии: в WSB только VWAP (входит в «процент»); в Развороте — VWAP ±1.5 % и полосы Боллинджера (условие взвода).
export function setSeries(c, data, mode) {
  c.candles.setData(data.map((d) => ({ time: d.time, open: d.open, high: d.high, low: d.low, close: d.close })));
  const pick = (k) => data.filter((d) => typeof d[k] === "number" && Number.isFinite(d[k])).map((d) => ({ time: d.time, value: d[k] }));
  c.lines.vwap.setData(pick("vwap"));
  for (const k of ["vwapU2", "vwapL2", "bbUpper", "bbLower"]) c.lines[k].setData(mode === "mr" ? pick(k) : []);
}

export function setMarkers(c, markers) {
  c.candles.setMarkers(markers.map(toWordless));
}

// Последние 6 боксов + активный; цвет — по направлению теней.
export function drawBoxes(c, svg, wsb, data, mode) {
  svg.innerHTML = "";
  if (mode !== "wsb" || !wsb || data.length === 0) return;
  const boxes = (wsb.allBoxes || []).slice(-6);
  if (wsb.activeBox && !boxes.includes(wsb.activeBox)) boxes.push(wsb.activeBox);
  const ts = c.chart.timeScale();
  const lastTime = data[data.length - 1].time;
  const width = svg.clientWidth;
  for (const box of boxes) {
    let x1 = ts.timeToCoordinate(box.startTime);
    let x2 = ts.timeToCoordinate(box.endTime || lastTime);
    const y1 = c.candles.priceToCoordinate(box.top);
    const y2 = c.candles.priceToCoordinate(box.bottom);
    if (y1 === null || y2 === null || (x1 === null && x2 === null)) continue;
    if (x1 === null) x1 = 0;
    if (x2 === null) x2 = width;
    const color = box.signalDir === "LONG" ? "#10b981" : "#f43f5e";
    svg.insertAdjacentHTML("beforeend",
      `<rect x="${Math.min(x1, x2)}" y="${Math.min(y1, y2)}" width="${Math.max(2, Math.abs(x2 - x1))}" height="${Math.max(1, Math.abs(y2 - y1))}" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-dasharray="4 3"/>`);
  }
}
