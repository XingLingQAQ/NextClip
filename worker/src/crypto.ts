/**
 * Password hashing using Web Crypto API (PBKDF2) for Cloudflare Workers.
 * Note: Workers don't have Node.js scrypt, so we use PBKDF2 with SHA-512.
 * For backward compatibility with Go server's scrypt hashes, we check the prefix.
 */

const ITERATIONS = 100000;
const HASH_ALGO = "pbkdf2";
const KEY_LEN = 64;
const SALT_LEN = 16;

function bufToBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function base64ToBuf(b64: string): Uint8Array {
  const binary = atob(b64);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
  return buf;
}

export async function hashPassword(plainText: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", encoder.encode(plainText), "PBKDF2", false, ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-512" },
    keyMaterial, KEY_LEN * 8
  );
  const saltB64 = bufToBase64(salt);
  const derivedB64 = bufToBase64(derived);
  return `${HASH_ALGO}$${ITERATIONS}$${saltB64}$${derivedB64}`;
}

export async function verifyPassword(plainText: string, storedHash: string): Promise<{ matched: boolean; needsRehash: boolean }> {
  // PBKDF2 format: pbkdf2$iterations$salt$digest
  if (storedHash.startsWith(`${HASH_ALGO}$`)) {
    const parts = storedHash.split("$");
    if (parts.length !== 4) return { matched: false, needsRehash: false };
    const [, iterStr, saltB64, digestB64] = parts;
    const iterations = parseInt(iterStr, 10);
    if (!iterations || !saltB64 || !digestB64) return { matched: false, needsRehash: false };

    const salt = base64ToBuf(saltB64);
    const expected = base64ToBuf(digestB64);
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw", encoder.encode(plainText), "PBKDF2", false, ["deriveBits"]
    );
    const derived = new Uint8Array(await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations, hash: "SHA-512" },
      keyMaterial, KEY_LEN * 8
    ));

    if (expected.length !== derived.length) return { matched: false, needsRehash: false };
    let matched = true;
    for (let i = 0; i < derived.length; i++) {
      if (derived[i] !== expected[i]) matched = false;
    }
    return { matched, needsRehash: iterations !== ITERATIONS };
  }

  // Scrypt format from Go server: scrypt$N$r$p$salt$digest - cannot verify in Workers
  if (storedHash.startsWith("scrypt$")) {
    // Cannot verify scrypt in Workers; user needs to reset password
    return { matched: false, needsRehash: true };
  }

  // Legacy SHA-256
  if (/^[a-f0-9]{64}$/i.test(storedHash)) {
    const encoder = new TextEncoder();
    const hash = await crypto.subtle.digest("SHA-256", encoder.encode(plainText));
    const hex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
    const matched = hex === storedHash;
    return { matched, needsRehash: matched };
  }

  return { matched: false, needsRehash: false };
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function generateSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}
