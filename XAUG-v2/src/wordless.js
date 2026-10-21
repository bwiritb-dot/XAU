export const hasLetters = (s) => /[A-Za-zА-Яа-яЁё]/.test(String(s));

export function toWordless(m) {
  if (m.shape === "arrowUp" || m.shape === "arrowDown") {
    const n = parseInt(String(m.text).replace(/[^0-9]/g, ""), 10);
    return { ...m, text: Number.isFinite(n) ? String(n) : "" };
  }
  const t = String(m.text);
  const num = (t.match(/[-+]?\d+\.\d+/) || [""])[0];
  return { ...m, shape: /TP[123]/.test(t) ? "square" : "circle", text: num };
}
