// SourceCalc Background Service Worker
// Handles exchange rate updates and future premium features

const EXCHANGE_RATE_KEY = 'exchangeRate';
const RATE_UPDATE_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

// Fetch latest CNY/USD exchange rate
async function updateExchangeRate() {
  try {
    // Using a free exchange rate API
    const response = await fetch('https://open.er-api.com/v6/latest/CNY');
    if (response.ok) {
      const data = await response.json();
      const rate = data.rates.USD;
      await chrome.storage.local.set({
        [EXCHANGE_RATE_KEY]: rate,
        exchangeRateUpdated: Date.now(),
      });
      console.log('SourceCalc: Exchange rate updated:', rate);
      return rate;
    }
  } catch (e) {
    console.log('SourceCalc: Failed to fetch exchange rate, using default');
  }
  return 0.137; // fallback
}

// Update rate on install and periodically
chrome.runtime.onInstalled.addListener(() => {
  updateExchangeRate();
  chrome.alarms.create('updateRate', { periodInMinutes: 60 * 12 }); // every 12 hours
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'updateRate') {
    updateExchangeRate();
  }
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'getExchangeRate') {
    chrome.storage.local.get([EXCHANGE_RATE_KEY], (data) => {
      sendResponse({ rate: data[EXCHANGE_RATE_KEY] || 0.137 });
    });
    return true; // async response
  }
});
