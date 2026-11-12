// Toolbar click opens the game in its own tab — pointer lock and a full-size
// canvas don't fit in a popup.
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
});
