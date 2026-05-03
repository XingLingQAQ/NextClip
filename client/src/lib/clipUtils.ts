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

export function formatRelativeTime(timestamp: string): string {
  const lang = (localStorage.getItem("cloudclip-lang") as string) || "zh";
  const diffMs = Date.now() - new Date(timestamp).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return lang === "zh" ? "刚刚" : "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return lang === "zh" ? `${diffMin}分钟前` : `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return lang === "zh" ? `${diffHr}小时前` : `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return lang === "zh" ? `${diffDay}天前` : `${diffDay}d ago`;
  return new Date(timestamp).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
  });
}

export function downloadDataUrl(dataUrl: string, fileName: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
