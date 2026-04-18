function getPagePayload() {
  const selection = window.getSelection?.()?.toString().trim() || "";
  const title = document.title || "Untitled";
  const url = window.location.href;
  const descriptionMeta = document.querySelector('meta[name="description"], meta[property="og:description"]');
  const description = descriptionMeta?.getAttribute("content") || "";

  return {
    selection,
    title,
    url,
    description,
    htmlLang: document.documentElement.lang || "",
    capturedAt: new Date().toISOString(),
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "cloudclip:get-page-payload") {
    sendResponse({ ok: true, payload: getPagePayload() });
    return true;
  }
  return false;
});
