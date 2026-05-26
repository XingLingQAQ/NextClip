const appUrlInput = document.getElementById("appUrl");
const roomCodeInput = document.getElementById("roomCode");
const roomPasswordInput = document.getElementById("roomPassword");
const statusEl = document.getElementById("status");
const clipSelectionButton = document.getElementById("clipSelection");
const clipPageButton = document.getElementById("clipPage");

const STORAGE_KEY = "cloudclip-web-clipper-settings";
// Token is stored separately so password is never persisted
const TOKEN_KEY = "cloudclip-web-clipper-token";

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#ef4444" : "#22c55e";
}

async function loadSettings() {
  const result = await chrome.storage.local.get([STORAGE_KEY, TOKEN_KEY]);
  const settings = result[STORAGE_KEY] || {};
  appUrlInput.value = settings.appUrl || "";
  roomCodeInput.value = settings.roomCode || "";
  // Password is intentionally NOT loaded from storage (security)
  roomPasswordInput.value = "";
}

async function saveSettings() {
  const settings = {
    appUrl: appUrlInput.value.trim().replace(/\/$/, ""),
    roomCode: roomCodeInput.value.trim().toLowerCase(),
    // Note: password is NOT saved to storage for security
  };
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
  return settings;
}

async function getStoredToken() {
  const result = await chrome.storage.local.get(TOKEN_KEY);
  return result[TOKEN_KEY] || null;
}

async function storeToken(token) {
  await chrome.storage.local.set({ [TOKEN_KEY]: token });
}

async function clearToken() {
  await chrome.storage.local.remove(TOKEN_KEY);
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
    // If token expired/invalid (403), signal for refresh
    if (response.status === 403) {
      throw Object.assign(new Error(data?.message || "Unauthorized"), { tokenExpired: true });
    }
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
    const clipPayload = mode === "selection"
      ? buildSelectionClip(pagePayload)
      : buildPageLinkClip(pagePayload);

    // Try with existing stored token first
    let token = await getStoredToken();

    if (token) {
      try {
        await createClip(settings.appUrl, settings.roomCode, token, clipPayload);
        setStatus("Saved to CloudClip");
        return;
      } catch (err) {
        if (!err.tokenExpired) throw err;
        // Token expired, clear and fall through to re-join
        await clearToken();
      }
    }

    // No valid token — need to join room
    const roomPassword = roomPasswordInput.value.trim();
    token = await joinRoom(settings.appUrl, settings.roomCode, roomPassword);
    await storeToken(token);

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
