import type { Express, Request, RequestHandler } from "express";
import type { Server } from "http";
import { Server as SocketIOServer } from "socket.io";
import { storage } from "./storage";
import type { RoomDevice, RoomMessage, User } from "@shared/schema";
import crypto from "crypto";
import { z } from "zod";

const VALID_EXPIRY = new Set(["1", "24", "168", "720", "permanent"]);
const ROOM_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

type RoomTokenEntry = {
  expiresAt: number;
};

const roomTokens = new Map<string, Map<string, RoomTokenEntry>>();
const roomDeviceState = new Map<string, Map<string, RoomDevice>>();
const CSRF_COOKIE_NAME = "csrf-token";

declare global {
  namespace Express {
    interface Request {
      currentUser?: User;
    }
  }
}

function getRoomTokenFromRequest(req: Request): string | null {
  const headerToken = req.header("x-room-token");
  if (headerToken && headerToken.trim()) return headerToken.trim();
  if (typeof req.query?.token === "string" && req.query.token.trim()) return req.query.token.trim();
  if (typeof req.body?.token === "string" && req.body.token.trim()) return req.body.token.trim();
  return null;
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

function ensureCsrfCookie(req: Request, res: any): string {
  const cookies = parseCookies(req.headers.cookie);
  const existing = cookies[CSRF_COOKIE_NAME];
  if (existing) return existing;
  const token = crypto.randomUUID();
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return token;
}

/** API contract: identity must come from server-verified token/session only (HttpOnly cookie or Bearer token), never from body/query params. */
const requireAuth: RequestHandler = (req, res, next) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  const user = storage.getUserById(userId);
  if (!user) return res.status(401).json({ message: "Unauthorized" });
  req.currentUser = user;
  next();
};

const attachCurrentUser: RequestHandler = (req, _res, next) => {
  if (req.session?.userId) {
    const user = storage.getUserById(req.session.userId);
    if (user) {
      req.currentUser = user;
    } else {
      req.session.userId = undefined;
    }
  }
  next();
};

const clipPayloadSchema = z.object({
  content: z.string().max(200000).optional().default(""),
  type: z.enum(["text", "link", "code", "image", "file", "mixed"]).optional().default("text"),
  sourceDevice: z.string().max(120).optional().default("Web Clipper"),
  metadata: z.string().max(20000).optional(),
  isSensitive: z.boolean().optional().default(false),
  burnAfterRead: z.boolean().optional().default(false),
  attachments: z.array(z.object({
    name: z.string().max(256),
    mimeType: z.string().max(120),
    data: z.string().max(10 * 1024 * 1024),
    size: z.number().min(0).max(10 * 1024 * 1024),
  })).max(10).optional(),
});

function assertRoomOwner(
  roomCode: string,
  userId: string,
  hasValidRoomToken: boolean,
): { ok: true; room: NonNullable<ReturnType<typeof storage.getRoom>> } | { ok: false; status: number; message: string } {
  const room = storage.getRoom(roomCode);
  if (!room) return { ok: false, status: 404, message: "Room not found" };
  if (!room.ownerId) {
    if (!hasValidRoomToken) {
      return { ok: false, status: 403, message: "Only the room owner can perform this action" };
    }
    return { ok: true, room };
  }
  if (room.ownerId !== userId) {
    return { ok: false, status: 403, message: "Only the room owner can perform this action" };
  }
  return { ok: true, room };
}

function issueRoomToken(roomCode: string): string {
  const token = crypto.randomUUID();
  if (!roomTokens.has(roomCode)) roomTokens.set(roomCode, new Map());
  roomTokens.get(roomCode)!.set(token, { expiresAt: Date.now() + ROOM_TOKEN_TTL_MS });
  return token;
}

function validateRoomToken(roomCode: string, token: string): boolean {
  const roomTokenMap = roomTokens.get(roomCode);
  if (!roomTokenMap) return false;
  const entry = roomTokenMap.get(token);
  if (!entry) return false;
  if (entry.expiresAt < Date.now()) {
    roomTokenMap.delete(token);
    return false;
  }
  return true;
}

function revokeRoomTokens(roomCode: string): void {
  roomTokens.delete(roomCode);
}

function cleanExpiredRoomTokens(): void {
  const now = Date.now();
  roomTokens.forEach((tokens, roomCode) => {
    tokens.forEach((entry, token) => {
      if (entry.expiresAt < now) tokens.delete(token);
    });
    if (tokens.size === 0) roomTokens.delete(roomCode);
  });
}

function getRoomDevices(roomCode: string): RoomDevice[] {
  return Array.from(roomDeviceState.get(roomCode)?.values() || []);
}

function emitRoomUsers(io: SocketIOServer, roomCode: string): void {
  io.to(roomCode).emit("room-users", io.sockets.adapter.rooms.get(roomCode)?.size || 0);
  io.to(roomCode).emit("room-devices", getRoomDevices(roomCode));
}

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function rateLimit(keyPrefix: string, limit: number, windowMs: number): RequestHandler {
  return (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();
    const current = rateBuckets.get(key);
    if (!current || current.resetAt <= now) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (current.count >= limit) {
      return res.status(429).json({ message: "Too many requests, please try again later." });
    }
    current.count += 1;
    return next();
  };
}

const requireCsrfForSessionMutations: RequestHandler = (req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  if (!req.path.startsWith("/api")) return next();
  if (!req.session?.userId) return next();
  if (req.path === "/api/auth/login" || req.path === "/api/auth/register") return next();

  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies[CSRF_COOKIE_NAME];
  const headerToken = req.header("x-csrf-token");

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ message: "Invalid CSRF token" });
  }
  return next();
};

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  app.use("/api", attachCurrentUser);
  app.use((req, res, next) => {
    ensureCsrfCookie(req, res);
    next();
  });
  app.use(requireCsrfForSessionMutations);
  setInterval(cleanExpiredRoomTokens, 60 * 1000);

  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.length === 0) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error("Origin not allowed"));
      },
    },
    path: "/socket.io",
    maxHttpBufferSize: 10 * 1024 * 1024,
  });

  app.get("/api/auth/csrf", (req, res) => {
    const token = ensureCsrfCookie(req, res);
    res.json({ csrfToken: token });
  });

  app.post("/api/auth/register", rateLimit("auth-register", 20, 10 * 60 * 1000), (req, res) => {
    const { username, password } = req.body;
    if (!username || typeof username !== "string" || !password || typeof password !== "string" || username.trim().length < 2 || password.length < 4) {
      return res.status(400).json({ message: "Username (2+ chars) and password (4+ chars) required" });
    }
    const existing = storage.getUser(username.trim());
    if (existing) return res.status(409).json({ message: "Username already taken" });
    const user = storage.createUser(username.trim(), password);
    req.session.userId = user.id;
    res.json({ success: true, user });
  });

  app.post("/api/auth/login", rateLimit("auth-login", 30, 10 * 60 * 1000), (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: "Username and password required" });
    const user = storage.verifyUser(username.trim(), password);
    if (!user) return res.status(401).json({ message: "Invalid credentials" });
    req.session.userId = user.id;
    res.json({ success: true, user });
  });

  app.get("/api/auth/me", requireAuth, (req, res) => {
    res.json({ user: req.currentUser });
  });

  app.post("/api/auth/logout", requireAuth, (req, res) => {
    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.json({ success: true });
    });
  });

  app.get("/api/rooms/:roomCode", (req, res) => {
    const room = storage.getRoom(req.params.roomCode);
    if (!room) return res.json({ exists: false });
    const token = getRoomTokenFromRequest(req);
    const canManage = !!req.currentUser?.id && room.ownerId === req.currentUser.id && !!token && validateRoomToken(room.roomCode, token);
    res.json({
      exists: true,
      hasPassword: room.hasPassword,
      canManage,
      ...(canManage ? { expiresAt: room.expiresAt, createdAt: room.createdAt } : {}),
    });
  });

  app.post("/api/rooms/:roomCode/join", rateLimit("room-join", 60, 10 * 60 * 1000), (req, res) => {
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

  app.post("/api/rooms/:roomCode/password", rateLimit("room-password", 20, 10 * 60 * 1000), requireAuth, (req, res) => {
    const roomCode = String(req.params.roomCode);
    const password = typeof req.body?.password === "string" ? req.body.password : null;
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    const currentUser = req.currentUser!;
    const hasValidRoomToken = validateRoomToken(roomCode, token);
    if (!hasValidRoomToken) {
      return res.status(403).json({ message: "Unauthorized" });
    }
    const ownerCheck = assertRoomOwner(roomCode, currentUser.id, hasValidRoomToken);
    if (!ownerCheck.ok) return res.status(ownerCheck.status).json({ message: ownerCheck.message });
    if (password) {
      if (password.length !== 6 || !/^\d{6}$/.test(password)) {
        return res.status(400).json({ message: "Password must be exactly 6 digits" });
      }
    }
    storage.setRoomPassword(roomCode, password || null);
    revokeRoomTokens(roomCode);
    res.json({ success: true });
  });

  app.post("/api/rooms/:roomCode/expiry", rateLimit("room-expiry", 20, 10 * 60 * 1000), requireAuth, (req, res) => {
    const roomCode = String(req.params.roomCode);
    const expiryHours = typeof req.body?.expiryHours === "string" ? req.body.expiryHours : String(req.body?.expiryHours || "");
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    const currentUser = req.currentUser!;
    const hasValidRoomToken = validateRoomToken(roomCode, token);
    if (!hasValidRoomToken) {
      return res.status(403).json({ message: "Unauthorized" });
    }
    const ownerCheck = assertRoomOwner(roomCode, currentUser.id, hasValidRoomToken);
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
  app.post("/api/rooms/:roomCode/clips", rateLimit("clips-post", 200, 10 * 60 * 1000), (req, res) => {
    const roomCode = String(req.params.roomCode);
    const token = getRoomTokenFromRequest(req);
    if (!token || !validateRoomToken(roomCode, token)) {
      return res.status(403).json({ message: "Unauthorized" });
    }
    if (!storage.roomExists(roomCode)) {
      return res.status(404).json({ message: "Room not found" });
    }

    const parsed = clipPayloadSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid clip payload" });
    }
    const { content, sourceDevice, metadata, attachments, isSensitive, burnAfterRead, type } = parsed.data;

    if (!content && (!attachments || attachments.length === 0)) {
      return res.status(400).json({ message: "Clip content or attachments required" });
    }

    const clip = storage.createClip(roomCode, content.trim(), type, sourceDevice.trim(), metadata, isSensitive, burnAfterRead, attachments);
    io.to(roomCode).emit("room-message", { type: "clip:new", clip } as RoomMessage);
    res.json({ success: true, clip });
  });

  app.get("/api/rooms/:roomCode/clips", (req, res) => {
    const roomCode = String(req.params.roomCode);
    const token = getRoomTokenFromRequest(req);
    if (!token || !validateRoomToken(roomCode, token)) {
      return res.status(403).json({ message: "Unauthorized" });
    }
    if (!storage.roomExists(roomCode)) {
      return res.status(404).json({ message: "Room not found" });
    }
    const before = typeof req.query.before === "string" ? req.query.before : undefined;
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    const clips = storage.getClipsByRoomPage(roomCode, before, limit || 50);
    const nextCursor = clips.length > 0 ? clips[clips.length - 1].timestamp : null;
    res.json({
      clips,
      pinnedClipIds: storage.getPinnedClipIds(roomCode),
      nextCursor,
    });
  });

  app.delete("/api/rooms/:roomCode/clips/:clipId", (req, res) => {
    const roomCode = String(req.params.roomCode);
    const token = getRoomTokenFromRequest(req);
    if (!token || !validateRoomToken(roomCode, token)) {
      return res.status(403).json({ message: "Unauthorized" });
    }
    if (!storage.roomExists(roomCode)) {
      return res.status(404).json({ message: "Room not found" });
    }
    const deleted = storage.deleteClip(req.params.clipId, req.params.roomCode);
    if (!deleted) return res.status(404).json({ message: "Clip not found" });
    res.json({ success: true });
  });

  app.delete("/api/rooms/:roomCode/clips", (req, res) => {
    const roomCode = String(req.params.roomCode);
    const token = getRoomTokenFromRequest(req);
    if (!token || !validateRoomToken(roomCode, token)) {
      return res.status(403).json({ message: "Unauthorized" });
    }
    if (!storage.roomExists(roomCode)) {
      return res.status(404).json({ message: "Room not found" });
    }
    res.json({ success: true, deleted: storage.clearRoom(roomCode) });
  });

  app.post("/api/rooms/:roomCode/pins/:clipId", (req, res) => {
    const roomCode = String(req.params.roomCode);
    const clipId = String(req.params.clipId);
    const token = getRoomTokenFromRequest(req);
    if (!token || !validateRoomToken(roomCode, token)) {
      return res.status(403).json({ message: "Unauthorized" });
    }
    const pinned = !!req.body?.pinned;
    const success = storage.setClipPinned(roomCode, clipId, pinned);
    if (!success) return res.status(404).json({ message: "Clip not found" });
    res.json({ success: true, pinned });
  });

  // ===== Socket.io =====
  io.on("connection", (socket) => {
    let currentRoom: string | null = null;

    socket.on("join-room", (data: { roomCode: string; token: string; deviceId?: string; deviceName?: string } | string) => {
      const roomCode = typeof data === "string" ? data : data.roomCode;
      const token = typeof data === "string" ? "" : data.token;
      const deviceId = typeof data === "string" ? "" : (data.deviceId || "");
      const deviceName = typeof data === "string" ? "Unknown Device" : (data.deviceName || "Unknown Device");

      if (!validateRoomToken(roomCode, token)) {
        socket.emit("room-error", { message: "Invalid room token. Please rejoin." });
        return;
      }

      if (currentRoom) socket.leave(currentRoom);
      currentRoom = roomCode;
      socket.join(roomCode);
      if (!roomDeviceState.has(roomCode)) roomDeviceState.set(roomCode, new Map());
      roomDeviceState.get(roomCode)!.set(socket.id, {
        socketId: socket.id,
        deviceId: deviceId || socket.id,
        deviceName,
      });
      socket.emit("room-message", {
        type: "clip:history",
        clips: storage.getClipsByRoom(roomCode),
        pinnedClipIds: storage.getPinnedClipIds(roomCode),
      } as RoomMessage);
      emitRoomUsers(io, roomCode);
    });

    socket.on("send-clip", (data: { content: string; type: string; sourceDevice: string; metadata?: string; isSensitive?: boolean; burnAfterRead?: boolean; attachments?: any[]; targetDeviceId?: string }) => {
      if (!currentRoom) return;
      if (!storage.roomExists(currentRoom)) {
        socket.emit("room-error", { message: "Room expired. Please rejoin." });
        return;
      }
      const clip = storage.createClip(currentRoom, data.content, data.type, data.sourceDevice,
        data.metadata, data.isSensitive, data.burnAfterRead, data.attachments);

      const targetDeviceId = typeof data?.targetDeviceId === "string" ? data.targetDeviceId : "";
      if (!targetDeviceId || targetDeviceId === "all") {
        io.to(currentRoom).emit("room-message", { type: "clip:new", clip } as RoomMessage);
        return;
      }

      const currentRoomDevices = roomDeviceState.get(currentRoom);
      if (!currentRoomDevices) return;

      currentRoomDevices.forEach((device) => {
        if (device.deviceId === targetDeviceId || device.socketId === socket.id) {
          io.to(device.socketId).emit("room-message", { type: "clip:new", clip } as RoomMessage);
        }
      });
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

    socket.on("pin-clip", (payload: { clipId: string; pinned: boolean }) => {
      if (!currentRoom) return;
      if (!payload?.clipId) return;
      const success = storage.setClipPinned(currentRoom, payload.clipId, !!payload.pinned);
      if (!success) return;
      io.to(currentRoom).emit("room-message", {
        type: "clip:pin",
        clipId: payload.clipId,
        pinState: !!payload.pinned,
        pinnedClipIds: storage.getPinnedClipIds(currentRoom),
      } as RoomMessage);
    });

    socket.on("disconnect", () => {
      if (!currentRoom) return;
      const roomDevices = roomDeviceState.get(currentRoom);
      if (roomDevices) {
        roomDevices.delete(socket.id);
        if (roomDevices.size === 0) roomDeviceState.delete(currentRoom);
      }
      emitRoomUsers(io, currentRoom);
    });
  });

  return httpServer;
}
