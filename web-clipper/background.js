chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "cloudclip-clip-selection",
    title: "Save selection to CloudClip",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "cloudclip-clip-selection" || !tab?.id) return;
  chrome.action.openPopup();
});
