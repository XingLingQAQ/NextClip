import type { Clip } from "@shared/schema";

const DEVICE_NAME_KEY = "cloudclip-device-name";

export function detectType(text: string): Clip["type"] {
  if (/^https?:\/\//.test(text.trim())) return "link";
  if (/[{}\[\];]|function\s|const\s|let\s|var\s|import\s|=>/.test(text)) return "code";
  return "text";
}

export function getDeviceName(): string {
  const storedName = getStoredDeviceName();
  if (storedName) return storedName;

  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/Linux/.test(ua)) return "Linux";
  return "Browser";
}

export function normalizeDeviceName(value: string): string {
  return value.trim().slice(0, 32);
}

export function getStoredDeviceName(): string {
  return normalizeDeviceName(localStorage.getItem(DEVICE_NAME_KEY) || "");
}

export function saveDeviceName(value: string): string {
  const normalized = normalizeDeviceName(value);
  if (!normalized) {
    localStorage.removeItem(DEVICE_NAME_KEY);
    return "";
  }
  localStorage.setItem(DEVICE_NAME_KEY, normalized);
  return normalized;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

export function downloadDataUrl(dataUrl: string, fileName: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
