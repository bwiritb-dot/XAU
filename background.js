/**
 * XAUG CHROME EXTENSION — BACKGROUND SERVICE WORKER
 * ==================================================
 * 1. Background ticker monitor
 * 2. Icon badge updates
 * 3. Desktop notifications on signals
 * 4. Full terminal tab management
 */

const SYMBOL = "XAUUSDT";
const TICKER_URL = `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${SYMBOL}`;

// Открытие полного терминала при установке
chrome.runtime.onInstalled.addListener((details) => {
  console.log("[XAUG] Расширение успешно установлено!", details);
  chrome.action.setBadgeBackgroundColor({ color: "#f59e0b" });
  chrome.action.setBadgeText({ text: "XAU" });

  if (details.reason === "install") {
    chrome.tabs.create({ url: "index.html" });
  }
});

// Периодическое обновление котировки на значке расширения
async function updateBadgePrice() {
  try {
    const resp = await fetch(TICKER_URL);
    if (!resp.ok) return;
    const data = await resp.json();
    const lastPrice = parseFloat(data.lastPrice);
    if (!isNaN(lastPrice)) {
      const priceK = (lastPrice).toFixed(0); // Например 2655
      chrome.action.setBadgeText({ text: priceK });
      const chg = parseFloat(data.priceChangePercent);
      chrome.action.setBadgeBackgroundColor({ color: chg >= 0 ? "#10b981" : "#f43f5e" });
      chrome.action.setTitle({ title: `XAUG: $${lastPrice.toFixed(2)} (${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%)` });
    }
  } catch (e) {
    // Тихо игнорируем сетевые сбои в фоне
  }
}

// Запуск фонового таймера обновления бейджа (раз в 15 секунд)
setInterval(updateBadgePrice, 15000);
updateBadgePrice();

// Обработка сообщений от страниц терминала и popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "open_full_terminal") {
    chrome.tabs.create({ url: "index.html" });
    sendResponse({ status: "ok" });
  } else if (msg.action === "signal_alert") {
    // Всплывающее системное уведомление Chrome
    if (chrome.notifications) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: msg.title || "XAUG Торговый Сигнал",
        message: msg.text || "Сформирован новый сигнал пробоя!",
        priority: 2
      });
    }
    sendResponse({ status: "ok" });
  }
  return true;
});
