/**
 * NextClip Cloudflare Worker - Main Entry Point
 * Provides the same API as the Go server but runs on Cloudflare's edge.
 * Uses D1 for persistence, Durable Objects for WebSocket rooms.
 */
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { Env, User } from "./types";
import auth from "./auth";
import rooms from "./rooms";
import clips from "./clips";
export { RoomDurableObject } from "./room-do";

const app = new Hono<{ Bindings: Env; Variables: { user?: User; sessionId?: string } }>();

// --- Middleware: Attach current user from session ---
app.use("/api/*", async (c, next) => {
  const sid = getCookie(c, "connect.sid");
  if (sid) {
    const row = await c.env.DB.prepare(
      "SELECT data, expires_at FROM user_sessions WHERE sid = ?"
    ).bind(sid).first<{ data: string; expires_at: number }>();
    if (row && row.expires_at > Date.now()) {
      try {
        const sessionData = JSON.parse(row.data);
        if (sessionData.userId) {
          const userRow = await c.env.DB.prepare(
            "SELECT id, username, created_at FROM users WHERE id = ?"
          ).bind(sessionData.userId).first<{ id: string; username: string; created_at: string }>();
          if (userRow) {
            c.set("user", { id: userRow.id, username: userRow.username, createdAt: userRow.created_at });
            c.set("sessionId", sid);
          }
        }
      } catch {}
    }
  }
  await next();
});

// --- Middleware: CSRF protection ---
app.use("/api/*", async (c, next) => {
  const method = c.req.method;
  if (method !== "POST" && method !== "PUT" && method !== "PATCH" && method !== "DELETE") {
    return next();
  }
  const path = new URL(c.req.url).pathname;
  if (path === "/api/auth/login" || path === "/api/auth/register") return next();

  const user = c.get("user");
  if (!user) return next();

  const cookieToken = getCookie(c, "csrf-token") || "";
  const headerToken = c.req.header("X-Csrf-Token") || "";
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return c.json({ message: "Invalid CSRF token" }, 403);
  }
  await next();
});

// --- Health endpoints ---
app.get("/healthz", (c) => c.json({ ok: true }));
app.get("/readyz", (c) => c.json({ ready: true }));

// --- WebSocket upgrade (routes to per-room Durable Object) ---
app.get("/ws", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.text("Expected WebSocket", 426);
  }

  // Client connects to /ws?room=<roomCode>
  // If no room param, use a default (client will send join-room with roomCode anyway)
  const roomCode = c.req.query("room") || "__default__";
  const doId = c.env.ROOM.idFromName(roomCode);
  const stub = c.env.ROOM.get(doId);
  return stub.fetch(c.req.raw);
});

// --- API routes ---
app.route("/api/auth", auth);
app.route("/api/rooms", rooms);
app.route("/api/rooms", clips);

// --- Static asset fallback (SPA) ---
// With wrangler [site] config, static files from dist/public are served automatically.
// This catches SPA routes that don't match static files.
app.get("*", (c) => {
  // Return index.html for SPA routing (handled by Workers Sites / Pages in production)
  return c.html("<!DOCTYPE html><html><body><p>NextClip Worker running. Deploy with client build for full app.</p></body></html>");
});

export default app;
