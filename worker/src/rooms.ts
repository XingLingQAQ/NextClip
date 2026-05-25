import { Hono } from "hono";
import type { Env, User } from "./types";
import { hashPassword, verifyPassword, generateId } from "./crypto";

// In-memory room tokens (per-isolate; acceptable for Workers since tokens are short-lived)
const roomTokens = new Map<string, Map<string, number>>(); // roomCode -> token -> expiresAt
const ROOM_TOKEN_TTL = 24 * 60 * 60 * 1000;

export function issueRoomToken(roomCode: string): string {
  const token = crypto.randomUUID();
  if (!roomTokens.has(roomCode)) roomTokens.set(roomCode, new Map());
  roomTokens.get(roomCode)!.set(token, Date.now() + ROOM_TOKEN_TTL);
  return token;
}

export function validateRoomToken(roomCode: string, token: string): boolean {
  const tokens = roomTokens.get(roomCode);
  if (!tokens) return false;
  const exp = tokens.get(token);
  if (!exp) return false;
  if (exp < Date.now()) { tokens.delete(token); return false; }
  return true;
}

function revokeRoomTokens(roomCode: string) { roomTokens.delete(roomCode); }

const rooms = new Hono<{ Bindings: Env; Variables: { user?: User } }>();

// Get room info
rooms.get("/:roomCode", async (c) => {
  const roomCode = c.req.param("roomCode");
  const row = await c.env.DB.prepare("SELECT room_code, password_hash, owner_id, expires_at, created_at FROM rooms WHERE room_code = ?")
    .bind(roomCode).first<any>();
  if (!row) return c.json({ exists: false });

  const user = c.get("user");
  const token = c.req.header("X-Room-Token") || c.req.query("token") || "";
  const canManage = !!user && row.owner_id === user.id && !!token && validateRoomToken(roomCode, token);

  const resp: any = { exists: true, hasPassword: !!row.password_hash, canManage };
  if (canManage) { resp.expiresAt = row.expires_at; resp.createdAt = row.created_at; }
  return c.json(resp);
});

// Join room
rooms.post("/:roomCode/join", async (c) => {
  const roomCode = c.req.param("roomCode");
  const body = await c.req.json<{ password?: string }>().catch(() => ({}));

  const row = await c.env.DB.prepare("SELECT room_code, password_hash, owner_id, expires_at FROM rooms WHERE room_code = ?")
    .bind(roomCode).first<any>();

  if (!row) {
    const expiresAt = new Date(Date.now() + 24 * 3600000).toISOString();
    const user = c.get("user");
    await c.env.DB.prepare("INSERT INTO rooms (room_code, password_hash, owner_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(roomCode, null, user?.id || null, expiresAt, new Date().toISOString()).run();
    const token = issueRoomToken(roomCode);
    return c.json({ success: true, created: true, hasPassword: false, token });
  }

  if (row.password_hash) {
    if (!body.password) return c.json({ message: "Password required", needPassword: true }, 401);
    const result = await verifyPassword(body.password, row.password_hash);
    if (!result.matched) return c.json({ message: "Incorrect password" }, 403);
    if (result.needsRehash) {
      const newHash = await hashPassword(body.password);
      await c.env.DB.prepare("UPDATE rooms SET password_hash = ? WHERE room_code = ?").bind(newHash, roomCode).run();
    }
  }

  const token = issueRoomToken(roomCode);
  return c.json({ success: true, created: false, hasPassword: !!row.password_hash, expiresAt: row.expires_at, token });
});

// Set password
rooms.post("/:roomCode/password", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ message: "Unauthorized" }, 401);
  const roomCode = c.req.param("roomCode");
  const body = await c.req.json<{ password?: string; token?: string }>();
  if (!body.token || !validateRoomToken(roomCode, body.token)) return c.json({ message: "Unauthorized" }, 403);

  if (body.password && !/^\d{6}$/.test(body.password)) {
    return c.json({ message: "Password must be exactly 6 digits" }, 400);
  }

  const hash = body.password ? await hashPassword(body.password) : null;
  await c.env.DB.prepare("UPDATE rooms SET password_hash = ? WHERE room_code = ?").bind(hash, roomCode).run();
  revokeRoomTokens(roomCode);
  return c.json({ success: true });
});

// Set expiry
rooms.post("/:roomCode/expiry", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ message: "Unauthorized" }, 401);
  const roomCode = c.req.param("roomCode");
  const body = await c.req.json<{ expiryHours?: string | number; token?: string }>();
  if (!body.token || !validateRoomToken(roomCode, body.token)) return c.json({ message: "Unauthorized" }, 403);

  const validExpiry = new Set(["1", "24", "168", "720", "permanent"]);
  const expiryStr = String(body.expiryHours || "");
  if (!validExpiry.has(expiryStr)) return c.json({ message: "Invalid expiry value" }, 400);

  let expiresAt: string | null = null;
  if (expiryStr !== "permanent") {
    expiresAt = new Date(Date.now() + parseInt(expiryStr) * 3600000).toISOString();
  }
  await c.env.DB.prepare("UPDATE rooms SET expires_at = ? WHERE room_code = ?").bind(expiresAt, roomCode).run();
  return c.json({ success: true, expiresAt });
});

export default rooms;
