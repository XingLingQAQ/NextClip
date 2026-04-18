import type { Express, Request, Response } from "express";
import type { Server } from "http";
import { Server as SocketIOServer } from "socket.io";
import { storage } from "./storage";
import type { RoomMessage } from "@shared/schema";
import crypto from "crypto";

const VALID_EXPIRY = new Set(["1", "24", "168", "720", "permanent"]);
const GENERIC_JOIN_FAILURE_MESSAGE = "Room code or password is invalid";

const roomTokens = new Map<string, Set<string>>();
const rateLimitBuckets = new Map<string, { count: number; windowStart: number }>();

function issueRoomToken(roomCode: string): string {
  const token = crypto.randomUUID();
  if (!roomTokens.has(roomCode)) roomTokens.set(roomCode, new Set());
  roomTokens.get(roomCode)!.add(token);
  return token;
}

function validateRoomToken(roomCode: string, token: string): boolean {
  return roomTokens.get(roomCode)?.has(token) || false;
}

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  if (Array.isArray(forwarded) && forwarded.length > 0) return forwarded[0].split(",")[0].trim();
  return req.ip || req.socket.remoteAddress || "unknown";
}

function applyRateLimit(
  req: Request,
  res: Response,
  opts: {
    scope: string;
    max: number;
    windowMs: number;
    accountResolver: (req: Request) => string;
  },
): boolean {
  const account = opts.accountResolver(req).toLowerCase();
  const ip = getClientIp(req);
  const now = Date.now();
  const key = `${opts.scope}:${ip}:${account}`;
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || now - bucket.windowStart >= opts.windowMs) {
    rateLimitBuckets.set(key, { count: 1, windowStart: now });
    return true;
  }

  if (bucket.count >= opts.max) {
    return res.status(429).json({ message: "Too many requests. Please retry later." }), false;
  }

  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);
  return true;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function respondObfuscatedJoinFailure(res: Response): Promise<void> {
  const jitterMs = 250 + Math.floor(Math.random() * 750);
  await sleep(jitterMs);
  res.status(403).json({ message: GENERIC_JOIN_FAILURE_MESSAGE });
}

function encodeBase32LowerNoPadding(input: Buffer): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0;
  let value = 0;
  let output = "";

  for (let i = 0; i < input.length; i += 1) {
    const byte = input[i];
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }

  return output;
}

function generateSecureRoomCode(): string {
  return encodeBase32LowerNoPadding(crypto.randomBytes(16)); // 128-bit entropy
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
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
    res.json({ success: true, user });
  });

  app.post("/api/auth/login", (req, res) => {
    if (!applyRateLimit(req, res, {
      scope: "auth:login",
      max: 10,
      windowMs: 5 * 60 * 1000,
      accountResolver: (r) => String(r.body?.username || "anonymous").trim() || "anonymous",
    })) {
      return;
    }

    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: "Username and password required" });
    const user = storage.verifyUser(username.trim(), password);
    if (!user) return res.status(401).json({ message: "Invalid credentials" });
    res.json({ success: true, user });
  });

  app.post("/api/rooms/code", (_req, res) => {
    let roomCode = "";
    do {
      roomCode = generateSecureRoomCode();
    } while (storage.roomExists(roomCode));

    res.json({ roomCode, entropyBits: 128, encoding: "base32" });
  });

  app.get("/api/rooms/:roomCode", (req, res) => {
    if (!applyRateLimit(req, res, {
      scope: "room:probe",
      max: 20,
      windowMs: 5 * 60 * 1000,
      accountResolver: (r) => String(r.query.userId || "anonymous").trim() || "anonymous",
    })) {
      return;
    }

    const roomCode = req.params.roomCode;
    const roomToken = String(req.headers["x-room-token"] || req.query.token || "");
    if (!validateRoomToken(roomCode, roomToken)) {
      return res.status(404).json({ message: "Unavailable" });
    }

    const room = storage.getRoom(roomCode);
    if (!room) return res.status(404).json({ message: "Unavailable" });

    res.json({
      hasPassword: room.hasPassword,
      expiresAt: room.expiresAt,
      createdAt: room.createdAt,
      ownerId: room.ownerId,
    });
  });

  app.post("/api/rooms/:roomCode/join", async (req, res) => {
    if (!applyRateLimit(req, res, {
      scope: "room:join",
      max: 20,
      windowMs: 5 * 60 * 1000,
      accountResolver: (r) => String(r.body?.userId || r.params.roomCode || "anonymous").trim() || "anonymous",
    })) {
      return;
    }

    const { roomCode } = req.params;
    const { password, userId, createIfMissing } = req.body;
    const room = storage.getRoom(roomCode);

    if (!room) {
      if (createIfMissing) {
        const expiresAt = new Date(Date.now() + 24 * 3600000).toISOString();
        const verifiedUserId = userId ? (storage.getUserById(userId) ? userId : null) : null;
        storage.createRoom(roomCode, verifiedUserId || undefined, undefined, expiresAt);
        const token = issueRoomToken(roomCode);
        return res.json({ success: true, created: true, hasPassword: false, token });
      }
      await respondObfuscatedJoinFailure(res);
      return;
    }

    if (room.hasPassword) {
      if (!password) return res.status(401).json({ message: "Password required", needPassword: true });
      if (!storage.verifyRoomPassword(roomCode, password)) {
        await respondObfuscatedJoinFailure(res);
        return;
      }
    }

    const token = issueRoomToken(roomCode);
    res.json({ success: true, created: false, hasPassword: room.hasPassword, expiresAt: room.expiresAt, token });
  });

  app.post("/api/rooms/:roomCode/password", (req, res) => {
    if (!applyRateLimit(req, res, {
      scope: "room:password",
      max: 12,
      windowMs: 5 * 60 * 1000,
      accountResolver: (r) => String(r.body?.userId || r.params.roomCode || "anonymous").trim() || "anonymous",
    })) {
      return;
    }

    const { roomCode } = req.params;
    const { password, token, userId } = req.body;
    if (!validateRoomToken(roomCode, token)) {
      return res.status(403).json({ message: "Unauthorized" });
    }
    const room = storage.getRoom(roomCode);
    if (!room) return res.status(404).json({ message: "Room not found" });
    if (room.ownerId && room.ownerId !== userId) {
      return res.status(403).json({ message: "Only the room owner can change the password" });
    }
    if (password) {
      if (typeof password !== "string" || password.length !== 6 || !/^\d{6}$/.test(password)) {
        return res.status(400).json({ message: "Password must be exactly 6 digits" });
      }
    }
    storage.setRoomPassword(roomCode, password || null);
    res.json({ success: true });
  });

  app.post("/api/rooms/:roomCode/expiry", (req, res) => {
    const { roomCode } = req.params;
    const { expiryHours, token, userId } = req.body;
    if (!validateRoomToken(roomCode, token)) {
      return res.status(403).json({ message: "Unauthorized" });
    }
    const room = storage.getRoom(roomCode);
    if (!room) return res.status(404).json({ message: "Room not found" });
    if (room.ownerId && room.ownerId !== userId) {
      return res.status(403).json({ message: "Only the room owner can change the expiry" });
    }
    if (!VALID_EXPIRY.has(String(expiryHours))) {
      return res.status(400).json({ message: "Invalid expiry value" });
    }
    let expiresAt: string | null = null;
    if (expiryHours === "permanent") {
      if (!userId || !storage.getUserById(userId)) {
        return res.status(403).json({ message: "Login required for permanent rooms" });
      }
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
