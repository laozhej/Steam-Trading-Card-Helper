chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: "https://steamcommunity.com/my/badges/" });
});
