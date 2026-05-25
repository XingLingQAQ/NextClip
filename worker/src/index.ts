/**
 * NextClip Cloudflare Worker - Main Entry Point
 * Provides the same API as the Go server but runs on Cloudflare's edge.
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
    const row = await c.env.DB.prepare("SELECT data, expires_at FROM user_sessions WHERE sid = ?")
      .bind(sid).first<{ data: string; expires_at: number }>();
    if (row && row.expires_at > Date.now()) {
      try {
        const sessionData = JSON.parse(row.data);
        if (sessionData.userId) {
          const userRow = await c.env.DB.prepare("SELECT id, username, created_at FROM users WHERE id = ?")
            .bind(sessionData.userId).first<{ id: string; username: string; created_at: string }>();
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

// --- WebSocket upgrade (routes to Durable Object) ---
app.get("/ws", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.text("Expected WebSocket", 426);
  }
  // Route to a global room DO (clients send join-room to specify which room)
  // In production, you'd route based on a query param for efficiency
  const doId = c.env.ROOM.idFromName("global-ws-hub");
  const stub = c.env.ROOM.get(doId);
  return stub.fetch(c.req.raw);
});

// --- API routes ---
app.route("/api/auth", auth);
app.route("/api/rooms", rooms);
app.route("/api/rooms", clips);

// --- Static asset fallback (SPA) ---
app.get("*", async (c) => {
  // In production with [site] config, Wrangler serves static assets automatically.
  // This is a fallback for SPA routing.
  return c.text("NextClip - Use the client app", 200);
});

export default app;
