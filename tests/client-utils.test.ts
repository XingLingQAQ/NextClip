import test from "node:test";
import assert from "node:assert/strict";

import {
  getDeviceName,
  getStoredDeviceName,
  normalizeDeviceName,
  saveDeviceName,
} from "../client/src/lib/clipUtils";
import { fetchWithCsrf, getCsrfToken, setCsrfToken } from "../client/src/lib/http";

function createStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value),
    removeItem: (key: string) => map.delete(key),
    clear: () => map.clear(),
  };
}

test("device name normalization and persistence", () => {
  (globalThis as any).localStorage = createStorage();
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "Macintosh" },
  });

  assert.equal(normalizeDeviceName("  Alice Laptop  "), "Alice Laptop");
  const saved = saveDeviceName("  Alice Laptop  ");
  assert.equal(saved, "Alice Laptop");
  assert.equal(getStoredDeviceName(), "Alice Laptop");
  assert.equal(getDeviceName(), "Alice Laptop");
});

test("csrf token helpers read and write session storage", () => {
  (globalThis as any).sessionStorage = createStorage();

  assert.equal(getCsrfToken(), "");
  setCsrfToken("abc123");
  assert.equal(getCsrfToken(), "abc123");
  setCsrfToken("");
  assert.equal(getCsrfToken(), "");
});

test("fetchWithCsrf attaches csrf token only for mutating methods", async () => {
  (globalThis as any).sessionStorage = createStorage();
  const calls: Array<{ headers: Headers; method: string; credentials: RequestCredentials | undefined }> = [];
  (globalThis as any).fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      headers: new Headers(init?.headers),
      method: (init?.method || "GET").toUpperCase(),
      credentials: init?.credentials,
    });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  setCsrfToken("token-1");
  await fetchWithCsrf("/api/example");
  await fetchWithCsrf("/api/example", { method: "POST" });

  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].headers.get("x-csrf-token"), null);
  assert.equal(calls[0].credentials, "same-origin");

  assert.equal(calls[1].method, "POST");
  assert.equal(calls[1].headers.get("x-csrf-token"), "token-1");
  assert.equal(calls[1].credentials, "same-origin");
});
