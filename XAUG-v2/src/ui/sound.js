import { isDeathZone } from "../core.js";

let audioCtx = null;

// Тот же звук, что playTripleAlertSound в app.js: 880 → 1174.66 → 1760 Гц.
export function playTriple() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = audioCtx || new AC();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const now = audioCtx.currentTime;
    for (const b of [{ freq: 880, start: 0, dur: 0.08 }, { freq: 1174.66, start: 0.12, dur: 0.08 }, { freq: 1760, start: 0.24, dur: 0.12 }]) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(b.freq, now + b.start);
      gain.gain.setValueAtTime(0.0001, now + b.start);
      gain.gain.exponentialRampToValueAtTime(0.3, now + b.start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + b.start + b.dur);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + b.start);
      osc.stop(now + b.start + b.dur + 0.02);
    }
  } catch (e) {
    console.warn("audio", e);
  }
}

export function shouldAlert(markers, bar, alerted) {
  if (!bar || isDeathZone(bar.time) || alerted.has(bar.time)) return false;
  const hit = markers.some((m) => m.time === bar.time && (m.shape === "arrowUp" || m.shape === "arrowDown"));
  if (hit) alerted.add(bar.time);
  return hit;
}
