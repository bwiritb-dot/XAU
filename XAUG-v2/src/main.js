import { isDeathZone } from "./core.js";
import { fetchKlines, connectStream, applyKline, mapRestKline, pipeline } from "./data.js";
import { wsbSignals, mrSignals, openTrade } from "./explain.js";
import { createChart, setSeries, setMarkers, drawBoxes } from "./ui/chart.js";
import { renderWsb } from "./ui/panel-wsb.js";
import { renderMr } from "./ui/panel-mr.js";
import { renderRuler } from "./ui/ruler.js";
import { playTriple, shouldAlert } from "./ui/sound.js";
import { ICON } from "./ui/icons.js";

const $ = (id) => document.getElementById(id);
const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
};

const S = {
  data: [], wsb: null, markers: [], signals: [],
  mode: store.get("xaug2.mode", "wsb"), sound: store.get("xaug2.sound", "1") === "1",
  selected: null, alerted: new Set(),
};
const C = createChart($("chart"));

function recompute(withMarkers) {
  const r = pipeline(S.data, S.mode);
  S.wsb = r.wsb;
  if (withMarkers) {
    S.markers = r.markers;
    S.signals = S.mode === "wsb" ? wsbSignals(S.data, S.wsb) : mrSignals(S.data, S.markers);
    setMarkers(C, S.markers);
  }
}

let raf = 0;
function render() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    const last = S.data[S.data.length - 1];
    if (!last) return;
    $("price").textContent = last.close.toFixed(2);
    document.body.classList.toggle("dead", isDeathZone(last.time));
    const signal = S.signals.find((s) => s.time === S.selected) || S.signals[S.signals.length - 1] || null;
    $("panel").innerHTML = S.mode === "wsb" ? renderWsb({ data: S.data, wsb: S.wsb, signal }) : renderMr({ data: S.data, signal });
    $("ruler").innerHTML = renderRuler({ trade: openTrade(S.signals, S.data), price: last.close, width: $("ruler").clientWidth - 120 });
    drawBoxes(C, $("boxes"), S.wsb, S.data, S.mode);
    document.querySelectorAll("#mode button").forEach((b) => b.classList.toggle("on", b.dataset.mode === S.mode));
    $("sound").classList.toggle("on", S.sound);
  });
}

function setMode(mode) {
  S.mode = mode;
  S.selected = null;
  store.set("xaug2.mode", mode);
  recompute(true);
  setSeries(C, S.data, S.mode);
  render();
}

function onCandle(candle) {
  applyKline(S.data, candle);
  recompute(candle.isClosed);
  setSeries(C, S.data, S.mode);
  if (candle.isClosed && S.sound && shouldAlert(S.markers, S.data[S.data.length - 1], S.alerted)) playTriple();
  render();
}

async function boot() {
  $("mode").querySelector('[data-mode="wsb"]').innerHTML = ICON.box;
  $("mode").querySelector('[data-mode="mr"]').innerHTML = ICON.wave;
  $("sound").innerHTML = ICON.sound;
  $("mode").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setMode(b.dataset.mode); });
  $("sound").addEventListener("click", () => { S.sound = !S.sound; store.set("xaug2.sound", S.sound ? "1" : "0"); render(); });
  C.chart.subscribeClick((p) => { if (p.time && S.signals.some((s) => s.time === p.time)) { S.selected = p.time; render(); } });
  C.chart.timeScale().subscribeVisibleTimeRangeChange(() => drawBoxes(C, $("boxes"), S.wsb, S.data, S.mode));

  const q = new URLSearchParams(location.search);
  if (q.get("fixture")) {
    const raw = await (await fetch("tests/fixtures/klines.json")).json();
    const end = Number(q.get("end")) || raw.length;
    S.data = raw.slice(Math.max(0, end - 1000), end).map(mapRestKline);
  } else {
    S.data = await fetchKlines();
  }
  recompute(true);
  setSeries(C, S.data, S.mode);
  render();
  if (q.get("fixture")) return;
  connectStream({
    onCandle,
    onStatus: (on) => $("live").classList.toggle("on", on),
    onStale: async () => {
      const fresh = await fetchKlines();
      if (fresh.length) { S.data = fresh; recompute(true); setSeries(C, S.data, S.mode); render(); }
    },
  });
}

boot();
