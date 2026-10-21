const TICKER_URL = "https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=XAUUSDT";

chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: "index.html" }));

async function updateBadgePrice() {
  try {
    const resp = await fetch(TICKER_URL);
    if (!resp.ok) return;
    const data = await resp.json();
    const lastPrice = parseFloat(data.lastPrice);
    if (isNaN(lastPrice)) return;
    const chg = parseFloat(data.priceChangePercent);
    chrome.action.setBadgeText({ text: lastPrice.toFixed(0) });
    chrome.action.setBadgeBackgroundColor({ color: chg >= 0 ? "#10b981" : "#f43f5e" });
    chrome.action.setTitle({ title: `$${lastPrice.toFixed(2)} (${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%)` });
  } catch (e) {}
}

setInterval(updateBadgePrice, 15000);
updateBadgePrice();
