import type { Express, Request, RequestHandler } from "express";
import type { Server } from "http";
import { Server as SocketIOServer } from "socket.io";
import { storage } from "./storage";
import type { RoomMessage, User } from "@shared/schema";
import crypto from "crypto";

const VALID_EXPIRY = new Set(["1", "24", "168", "720", "permanent"]);
const AUTH_COOKIE_NAME = "session";
const AUTH_SIGNING_SECRET = process.env.AUTH_SIGNING_SECRET || "dev-auth-secret-change-me";

const roomTokens = new Map<string, Set<string>>();

declare global {
  namespace Express {
    interface Request {
      currentUser?: User;
    }
  }
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function signHmac(value: string): string {
  return crypto.createHmac("sha256", AUTH_SIGNING_SECRET).update(value).digest("base64url");
}

function issueAuthToken(user: User): string {
  const payload = base64UrlEncode(JSON.stringify({
    sub: user.id,
    username: user.username,
    iat: Date.now(),
  }));
  const signature = signHmac(payload);
  return `${payload}.${signature}`;
}

function readUserFromToken(token: string): User | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  if (signHmac(payload) !== signature) return null;
  try {
    const parsed = JSON.parse(base64UrlDecode(payload)) as { sub?: string };
    if (!parsed.sub) return null;
    return storage.getUserById(parsed.sub);
  } catch {
    return null;
  }
}

function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) return {};
  return cookieHeader.split(";").reduce<Record<string, string>>((acc, part) => {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawKey) return acc;
    acc[rawKey] = decodeURIComponent(rawValue.join("=") || "");
    return acc;
  }, {});
}

function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  if (!authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice("Bearer ".length).trim() || null;
}

/** API contract: identity must come from server-verified token/session only (HttpOnly cookie or Bearer token), never from body/query params. */
const requireAuth: RequestHandler = (req, res, next) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[AUTH_COOKIE_NAME] || getBearerToken(req);
  if (!token) return res.status(401).json({ message: "Unauthorized" });
  const user = readUserFromToken(token);
  if (!user) return res.status(401).json({ message: "Unauthorized" });
  req.currentUser = user;
  next();
};

const attachCurrentUser: RequestHandler = (req, _res, next) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[AUTH_COOKIE_NAME] || getBearerToken(req);
  if (token) {
    const user = readUserFromToken(token);
    if (user) req.currentUser = user;
  }
  next();
};

function assertRoomOwner(roomCode: string, userId: string): { ok: true; room: NonNullable<ReturnType<typeof storage.getRoom>> } | { ok: false; status: number; message: string } {
  const room = storage.getRoom(roomCode);
  if (!room) return { ok: false, status: 404, message: "Room not found" };
  if (!room.ownerId || room.ownerId !== userId) {
    return { ok: false, status: 403, message: "Only the room owner can perform this action" };
  }
  return { ok: true, room };
}

function issueRoomToken(roomCode: string): string {
  const token = crypto.randomUUID();
  if (!roomTokens.has(roomCode)) roomTokens.set(roomCode, new Set());
  roomTokens.get(roomCode)!.add(token);
  return token;
}

function validateRoomToken(roomCode: string, token: string): boolean {
  return roomTokens.get(roomCode)?.has(token) || false;
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  app.use("/api", attachCurrentUser);

  const io = new SocketIOServer(httpServer, {
    cors: { origin: "*" },
    path: "/socket.io",
    maxHttpBufferSize: 10 * 1024 * 1024,
  });

  app.post("/api/auth/register", (req, res) => {
    const { username, password } = req.body;
    if (!username || typeof username !== "string" || !password || typeof password !== "string" || username.trim().length < 2 || password.length < 4) {
      return res.status(400).json({ message: "Username (2+ chars) and password (4+ chars) required" });
    }
    const existing = storage.getUser(username.trim());
    if (existing) return res.status(409).json({ message: "Username already taken" });
    const user = storage.createUser(username.trim(), password);
    const token = issueAuthToken(user);
    res.cookie(AUTH_COOKIE_NAME, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
    res.json({ success: true, user });
  });

  app.post("/api/auth/login", (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: "Username and password required" });
    const user = storage.verifyUser(username.trim(), password);
    if (!user) return res.status(401).json({ message: "Invalid credentials" });
    const token = issueAuthToken(user);
    res.cookie(AUTH_COOKIE_NAME, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
    res.json({ success: true, user });
  });

  app.get("/api/rooms/:roomCode", (req, res) => {
    const room = storage.getRoom(req.params.roomCode);
    if (!room) return res.json({ exists: false });
    res.json({
      exists: true,
      hasPassword: room.hasPassword,
      expiresAt: room.expiresAt,
      createdAt: room.createdAt,
      isOwner: !!req.currentUser?.id && room.ownerId === req.currentUser.id,
    });
  });

  app.post("/api/rooms/:roomCode/join", (req, res) => {
    const roomCode = String(req.params.roomCode);
    const password = typeof req.body?.password === "string" ? req.body.password : undefined;
    const room = storage.getRoom(roomCode);

    if (!room) {
      let expiresAt: string | null = null;
      expiresAt = new Date(Date.now() + 24 * 3600000).toISOString();
      storage.createRoom(roomCode, req.currentUser?.id, undefined, expiresAt);
      const token = issueRoomToken(roomCode);
      return res.json({ success: true, created: true, hasPassword: false, token });
    }

    if (room.hasPassword) {
      if (!password) return res.status(401).json({ message: "Password required", needPassword: true });
      if (!storage.verifyRoomPassword(roomCode, password)) {
        return res.status(403).json({ message: "Incorrect password" });
      }
    }

    const token = issueRoomToken(roomCode);
    res.json({ success: true, created: false, hasPassword: room.hasPassword, expiresAt: room.expiresAt, token });
  });

  app.post("/api/rooms/:roomCode/password", requireAuth, (req, res) => {
    const roomCode = String(req.params.roomCode);
    const password = typeof req.body?.password === "string" ? req.body.password : null;
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    const currentUser = req.currentUser!;
    if (!validateRoomToken(roomCode, token)) {
      return res.status(403).json({ message: "Unauthorized" });
    }
    const ownerCheck = assertRoomOwner(roomCode, currentUser.id);
    if (!ownerCheck.ok) return res.status(ownerCheck.status).json({ message: ownerCheck.message });
    if (password) {
      if (password.length !== 6 || !/^\d{6}$/.test(password)) {
        return res.status(400).json({ message: "Password must be exactly 6 digits" });
      }
    }
    storage.setRoomPassword(roomCode, password || null);
    res.json({ success: true });
  });

  app.post("/api/rooms/:roomCode/expiry", requireAuth, (req, res) => {
    const roomCode = String(req.params.roomCode);
    const expiryHours = typeof req.body?.expiryHours === "string" ? req.body.expiryHours : String(req.body?.expiryHours || "");
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    const currentUser = req.currentUser!;
    if (!validateRoomToken(roomCode, token)) {
      return res.status(403).json({ message: "Unauthorized" });
    }
    const ownerCheck = assertRoomOwner(roomCode, currentUser.id);
    if (!ownerCheck.ok) return res.status(ownerCheck.status).json({ message: ownerCheck.message });
    if (!VALID_EXPIRY.has(String(expiryHours))) {
      return res.status(400).json({ message: "Invalid expiry value" });
    }
    let expiresAt: string | null = null;
    if (expiryHours === "permanent") {
      expiresAt = null;
    } else {
      expiresAt = new Date(Date.now() + parseInt(String(expiryHours)) * 3600000).toISOString();
    }
    storage.setRoomExpiry(roomCode, expiresAt);
    res.json({ success: true, expiresAt });
  });

  // ===== Clips REST =====
  app.get("/api/rooms/:roomCode/clips", (req, res) => {
    res.json(storage.getClipsByRoom(req.params.roomCode));
  });

  app.delete("/api/rooms/:roomCode/clips/:clipId", (req, res) => {
    const deleted = storage.deleteClip(req.params.clipId, req.params.roomCode);
    if (!deleted) return res.status(404).json({ message: "Clip not found" });
    res.json({ success: true });
  });

  app.delete("/api/rooms/:roomCode/clips", (req, res) => {
    res.json({ success: true, deleted: storage.clearRoom(req.params.roomCode) });
  });

  // ===== Socket.io =====
  io.on("connection", (socket) => {
    let currentRoom: string | null = null;

    socket.on("join-room", (data: { roomCode: string; token: string } | string) => {
      const roomCode = typeof data === "string" ? data : data.roomCode;
      const token = typeof data === "string" ? "" : data.token;

      if (!validateRoomToken(roomCode, token)) {
        socket.emit("room-error", { message: "Invalid room token. Please rejoin." });
        return;
      }

      if (currentRoom) socket.leave(currentRoom);
      currentRoom = roomCode;
      socket.join(roomCode);
      socket.emit("room-message", { type: "clip:history", clips: storage.getClipsByRoom(roomCode) } as RoomMessage);
      io.to(roomCode).emit("room-users", io.sockets.adapter.rooms.get(roomCode)?.size || 0);
    });

    socket.on("send-clip", (data: any) => {
      if (!currentRoom) return;
      const clip = storage.createClip(currentRoom, data.content, data.type, data.sourceDevice,
        data.metadata, data.isSensitive, data.burnAfterRead, data.attachments);
      io.to(currentRoom).emit("room-message", { type: "clip:new", clip } as RoomMessage);
    });

    socket.on("update-clip", (data: { clipId: string; content: string; type: string }) => {
      if (!currentRoom) return;
      if (storage.updateClip(data.clipId, currentRoom, data.content, data.type)) {
        const clip = storage.getClipsByRoom(currentRoom).find((c) => c.id === data.clipId);
        if (clip) io.to(currentRoom).emit("room-message", { type: "clip:update", clip } as RoomMessage);
      }
    });

    socket.on("delete-clip", (clipId: string) => {
      if (!currentRoom) return;
      if (storage.deleteClip(clipId, currentRoom)) {
        io.to(currentRoom).emit("room-message", { type: "clip:delete", clipId } as RoomMessage);
      }
    });

    socket.on("clear-room", () => {
      if (!currentRoom) return;
      storage.clearRoom(currentRoom);
      io.to(currentRoom).emit("room-message", { type: "clip:clear" } as RoomMessage);
    });

    socket.on("disconnect", () => {
      if (currentRoom) io.to(currentRoom).emit("room-users", io.sockets.adapter.rooms.get(currentRoom)?.size || 0);
    });
  });

  return httpServer;
}
