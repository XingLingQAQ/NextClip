import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Env, User } from "./types";
import { hashPassword, verifyPassword, generateId, generateSessionId } from "./crypto";

const auth = new Hono<{ Bindings: Env; Variables: { user?: User; sessionId?: string } }>();

// CSRF token endpoint
auth.get("/csrf", (c) => {
  let token = getCookie(c, "csrf-token");
  if (!token) {
    token = crypto.randomUUID();
    setCookie(c, "csrf-token", token, { httpOnly: false, sameSite: "Lax", path: "/" });
  }
  return c.json({ csrfToken: token });
});

// Register
auth.post("/register", async (c) => {
  const body = await c.req.json<{ username?: string; password?: string }>();
  const username = body.username?.trim();
  const password = body.password;

  if (!username || !password || username.length < 2 || password.length < 4) {
    return c.json({ message: "Username (2+ chars) and password (4+ chars) required" }, 400);
  }

  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(username).first();
  if (existing) return c.json({ message: "Username already taken" }, 409);

  const id = generateId();
  const createdAt = new Date().toISOString();
  const hash = await hashPassword(password);

  await c.env.DB.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, username, hash, createdAt).run();

  // Create session
  const sid = generateSessionId();
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  await c.env.DB.prepare("INSERT INTO user_sessions (sid, expires_at, data) VALUES (?, ?, ?)")
    .bind(sid, expiresAt, JSON.stringify({ userId: id })).run();

  setCookie(c, "connect.sid", sid, { httpOnly: true, sameSite: "Lax", path: "/", maxAge: 7 * 24 * 60 * 60 });

  const user: User = { id, username, createdAt };
  return c.json({ success: true, user });
});

// Login
auth.post("/login", async (c) => {
  const body = await c.req.json<{ username?: string; password?: string }>();
  if (!body.username || !body.password) return c.json({ message: "Username and password required" }, 400);

  const row = await c.env.DB.prepare("SELECT id, username, password_hash, created_at FROM users WHERE username = ?")
    .bind(body.username.trim()).first<{ id: string; username: string; password_hash: string; created_at: string }>();
  if (!row) return c.json({ message: "Invalid credentials" }, 401);

  const result = await verifyPassword(body.password, row.password_hash);
  if (!result.matched) return c.json({ message: "Invalid credentials" }, 401);

  if (result.needsRehash) {
    const newHash = await hashPassword(body.password);
    await c.env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(newHash, row.id).run();
  }

  const sid = generateSessionId();
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  await c.env.DB.prepare("INSERT INTO user_sessions (sid, expires_at, data) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET expires_at = excluded.expires_at, data = excluded.data")
    .bind(sid, expiresAt, JSON.stringify({ userId: row.id })).run();

  setCookie(c, "connect.sid", sid, { httpOnly: true, sameSite: "Lax", path: "/", maxAge: 7 * 24 * 60 * 60 });

  return c.json({ success: true, user: { id: row.id, username: row.username, createdAt: row.created_at } });
});

// Me
auth.get("/me", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ message: "Unauthorized" }, 401);
  return c.json({ user });
});

// Logout
auth.post("/logout", async (c) => {
  const sid = getCookie(c, "connect.sid");
  if (sid) {
    await c.env.DB.prepare("DELETE FROM user_sessions WHERE sid = ?").bind(sid).run();
  }
  deleteCookie(c, "connect.sid");
  return c.json({ success: true });
});

export default auth;
