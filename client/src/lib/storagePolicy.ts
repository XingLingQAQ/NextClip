export const STORAGE_KEYS = {
  room: "cloudclip-room",
  roomCreatorPrefix: "cloudclip-creator-",
  onboarded: "cloudclip-onboarded",
  favorites: "cloudclip-starred",
  lang: "cloudclip-lang",
  roomPwdSession: "cloudclip-room-pwd-session",
  deprecatedUser: "cloudclip-user",
  deprecatedRoomToken: "cloudclip-room-token",
} as const;

export type DataSensitivity = "sensitive" | "non-sensitive";

export const STORAGE_DATA_CLASSIFICATION: Record<string, DataSensitivity> = {
  user: "sensitive",
  token: "sensitive",
  favorites: "non-sensitive",
  lang: "non-sensitive",
};

type TtlStoragePayload = {
  value: string;
  expiresAt: number;
};

export function setSessionStorageWithTTL(key: string, value: string, ttlMs: number) {
  const payload: TtlStoragePayload = {
    value,
    expiresAt: Date.now() + ttlMs,
  };
  sessionStorage.setItem(key, JSON.stringify(payload));
}

export function getSessionStorageWithTTL(key: string): string {
  const raw = sessionStorage.getItem(key);
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as TtlStoragePayload;
    if (!parsed?.value || !parsed?.expiresAt || Date.now() > parsed.expiresAt) {
      sessionStorage.removeItem(key);
      return "";
    }
    return parsed.value;
  } catch {
    sessionStorage.removeItem(key);
    return "";
  }
}

export function clearDeprecatedSensitiveStorage() {
  localStorage.removeItem(STORAGE_KEYS.deprecatedUser);
  localStorage.removeItem(STORAGE_KEYS.deprecatedRoomToken);
}
