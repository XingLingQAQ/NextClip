const appUrlInput = document.getElementById("appUrl");
const roomCodeInput = document.getElementById("roomCode");
const roomPasswordInput = document.getElementById("roomPassword");
const roomTokenInput = document.getElementById("roomToken");
const statusEl = document.getElementById("status");
const clipSelectionButton = document.getElementById("clipSelection");
const clipPageButton = document.getElementById("clipPage");

const STORAGE_KEY = "cloudclip-web-clipper-settings";

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#ef4444" : "#22c55e";
}

async function loadSettings() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const settings = result[STORAGE_KEY] || {};
  appUrlInput.value = settings.appUrl || "";
  roomCodeInput.value = settings.roomCode || "";
  roomPasswordInput.value = settings.roomPassword || "";
  roomTokenInput.value = settings.roomToken || "";
}

async function saveSettings() {
  const settings = {
    appUrl: appUrlInput.value.trim().replace(/\/$/, ""),
    roomCode: roomCodeInput.value.trim().toLowerCase(),
    roomPassword: roomPasswordInput.value.trim(),
    roomToken: roomTokenInput.value.trim(),
  };
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
  return settings;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab");
  return tab;
}

async function getPagePayload() {
  const tab = await getActiveTab();
  const response = await chrome.tabs.sendMessage(tab.id, { type: "cloudclip:get-page-payload" });
  if (!response?.ok) throw new Error("Cannot read page content");
  return response.payload;
}

async function joinRoom(appUrl, roomCode, roomPassword) {
  const response = await fetch(`${appUrl}/api/rooms/${encodeURIComponent(roomCode)}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: roomPassword || undefined }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || "Failed to join room");
  }

  return data.token;
}

async function createClip(appUrl, roomCode, token, clipPayload) {
  const response = await fetch(`${appUrl}/api/rooms/${encodeURIComponent(roomCode)}/clips`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-room-token": token,
    },
    body: JSON.stringify(clipPayload),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || "Failed to save clip");
  }
}

function buildSelectionClip(pagePayload) {
  const content = pagePayload.selection || `${pagePayload.title}\n${pagePayload.url}`;
  const metadata = JSON.stringify({
    mode: "selection",
    title: pagePayload.title,
    url: pagePayload.url,
    description: pagePayload.description,
    htmlLang: pagePayload.htmlLang,
    capturedAt: pagePayload.capturedAt,
  });

  return {
    type: "mixed",
    content,
    metadata,
    sourceDevice: "Web Clipper",
  };
}

function buildPageLinkClip(pagePayload) {
  const content = `${pagePayload.title}\n${pagePayload.url}`;
  const metadata = JSON.stringify({
    mode: "page-link",
    title: pagePayload.title,
    url: pagePayload.url,
    description: pagePayload.description,
    htmlLang: pagePayload.htmlLang,
    capturedAt: pagePayload.capturedAt,
  });

  return {
    type: "link",
    content,
    metadata,
    sourceDevice: "Web Clipper",
  };
}

async function runClip(mode) {
  try {
    clipSelectionButton.disabled = true;
    clipPageButton.disabled = true;
    setStatus("Saving...");

    const settings = await saveSettings();
    if (!settings.appUrl || !settings.roomCode) {
      throw new Error("App URL and Room Code are required");
    }

    const pagePayload = await getPagePayload();
    const token = settings.roomToken
      ? settings.roomToken
      : await joinRoom(settings.appUrl, settings.roomCode, settings.roomPassword);

    const clipPayload = mode === "selection"
      ? buildSelectionClip(pagePayload)
      : buildPageLinkClip(pagePayload);

    await createClip(settings.appUrl, settings.roomCode, token, clipPayload);
    setStatus("Saved to CloudClip");
  } catch (error) {
    setStatus(error.message || "Failed", true);
  } finally {
    clipSelectionButton.disabled = false;
    clipPageButton.disabled = false;
  }
}

clipSelectionButton.addEventListener("click", () => runClip("selection"));
clipPageButton.addEventListener("click", () => runClip("page"));

loadSettings().catch(() => setStatus("Failed to load settings", true));
