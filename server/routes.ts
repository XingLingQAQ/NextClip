import type { Express, NextFunction, Request, Response } from "express";
import type { Server } from "http";
import { Server as SocketIOServer } from "socket.io";
import { storage } from "./storage";
import type { RoomMessage } from "@shared/schema";
import crypto from "crypto";

const VALID_EXPIRY = new Set(["1", "24", "168", "720", "permanent"]);

const roomTokens = new Map<string, Set<string>>();
const roomMembers = new Map<string, Set<string>>();

type RoomSession = {
  sessionId: string;
  roomCode: string;
  userId: string | null;
  token: string;
  passwordVerified: boolean;
};

const roomSessions = new Map<string, RoomSession>();

function issueRoomToken(roomCode: string): string {
  const token = crypto.randomUUID();
  if (!roomTokens.has(roomCode)) roomTokens.set(roomCode, new Set());
  roomTokens.get(roomCode)!.add(token);
  return token;
}

function validateRoomToken(roomCode: string, token: string): boolean {
  return roomTokens.get(roomCode)?.has(token) || false;
}

function addRoomMember(roomCode: string, userId: string | null) {
  if (!userId) return;
  if (!roomMembers.has(roomCode)) roomMembers.set(roomCode, new Set());
  roomMembers.get(roomCode)!.add(userId);
}

function isRoomMember(roomCode: string, userId: string | null): boolean {
  return !!(userId && roomMembers.get(roomCode)?.has(userId));
}

function createRoomSession(roomCode: string, token: string, userId: string | null, passwordVerified: boolean): string {
  const sessionId = crypto.randomUUID();
  roomSessions.set(sessionId, { sessionId, roomCode, userId, token, passwordVerified });
  return sessionId;
}

function getRequestAuth(req: Request, roomCode: string) {
  const rawBody = req.body && typeof req.body === "object" ? req.body : {};
  const queryString = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (Array.isArray(value) && typeof value[0] === "string") return value[0];
    return "";
  };
  const token = String(req.header("x-room-token") || queryString(req.query.token) || rawBody.token || "");
  const sessionId = String(req.header("x-room-session") || queryString(req.query.sessionId) || rawBody.sessionId || "");
  const userId = String(req.header("x-user-id") || queryString(req.query.userId) || rawBody.userId || "") || null;
  const session = sessionId ? roomSessions.get(sessionId) : undefined;
  const hasSessionIdentity = !!session && session.roomCode === roomCode;
  const validToken = !!token && validateRoomToken(roomCode, token);
  const memberByUserId = isRoomMember(roomCode, userId);
  const memberBySession = !!session?.userId && isRoomMember(roomCode, session.userId);
  const room = storage.getRoom(roomCode);
  const passwordOk = !room?.hasPassword || !!session?.passwordVerified;

  return {
    room,
    session,
    hasSessionIdentity,
    validToken,
    memberByUserId,
    memberBySession,
    passwordOk,
  };
}

function requireRoomAccess() {
  return (req: Request, res: Response, next: NextFunction) => {
    const roomCode = getRouteParam(req, "roomCode");
    const auth = getRequestAuth(req, roomCode);

    if (!auth.room) {
      return res.status(404).json({ message: "Room not found" });
    }

    if (!auth.hasSessionIdentity) {
      return res.status(401).json({ message: "Unauthorized: session required" });
    }

    if (!auth.memberByUserId && !auth.memberBySession && !auth.validToken) {
      return res.status(403).json({ message: "Forbidden: no room access" });
    }

    if (!auth.passwordOk) {
      return res.status(403).json({ message: "Forbidden: room password required" });
    }

    return next();
  };
}

function getRouteParam(req: Request, key: string): string {
  const value = req.params[key];
  return Array.isArray(value) ? (value[0] || "") : (value || "");
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
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: "Username and password required" });
    const user = storage.verifyUser(username.trim(), password);
    if (!user) return res.status(401).json({ message: "Invalid credentials" });
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
      ownerId: room.ownerId,
    });
  });

  app.post("/api/rooms/:roomCode/join", (req, res) => {
    const { roomCode } = req.params;
    const { password, userId } = req.body;
    const room = storage.getRoom(roomCode);

    if (!room) {
      let expiresAt: string | null = null;
      expiresAt = new Date(Date.now() + 24 * 3600000).toISOString();
      const verifiedUserId = userId ? (storage.getUserById(userId) ? userId : null) : null;
      storage.createRoom(roomCode, verifiedUserId || undefined, undefined, expiresAt);
      const token = issueRoomToken(roomCode);
      addRoomMember(roomCode, verifiedUserId);
      const sessionId = createRoomSession(roomCode, token, verifiedUserId, true);
      return res.json({ success: true, created: true, hasPassword: false, token, sessionId });
    }

    if (room.hasPassword) {
      if (!password) return res.status(401).json({ message: "Password required", needPassword: true });
      if (!storage.verifyRoomPassword(roomCode, password)) {
        return res.status(403).json({ message: "Incorrect password" });
      }
    }

    const token = issueRoomToken(roomCode);
    const verifiedUserId = userId ? (storage.getUserById(userId) ? userId : null) : null;
    addRoomMember(roomCode, verifiedUserId);
    const sessionId = createRoomSession(roomCode, token, verifiedUserId, room.hasPassword ? !!password : true);
    res.json({ success: true, created: false, hasPassword: room.hasPassword, expiresAt: room.expiresAt, token, sessionId });
  });

  app.post("/api/rooms/:roomCode/password", (req, res) => {
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
  app.get("/api/rooms/:roomCode/clips", requireRoomAccess(), (req, res) => {
    const roomCode = getRouteParam(req, "roomCode");
    res.json(storage.getClipsByRoom(roomCode));
  });

  app.delete("/api/rooms/:roomCode/clips/:clipId", requireRoomAccess(), (req, res) => {
    const clipId = getRouteParam(req, "clipId");
    const roomCode = getRouteParam(req, "roomCode");
    const deleted = storage.deleteClip(clipId, roomCode);
    if (!deleted) return res.status(404).json({ message: "Clip not found" });
    res.json({ success: true });
  });

  app.delete("/api/rooms/:roomCode/clips", requireRoomAccess(), (req, res) => {
    const roomCode = getRouteParam(req, "roomCode");
    res.json({ success: true, deleted: storage.clearRoom(roomCode) });
  });

  // ===== Socket.io =====
  io.on("connection", (socket) => {
    let currentRoom: string | null = null;
    let currentSession: RoomSession | null = null;

    socket.on("join-room", (data: { roomCode: string; token: string; sessionId?: string } | string) => {
      const roomCode = typeof data === "string" ? data : data.roomCode;
      const token = typeof data === "string" ? "" : data.token;
      const sessionId = typeof data === "string" ? "" : (data.sessionId || "");
      const session = sessionId ? roomSessions.get(sessionId) : undefined;

      if (!session || session.roomCode !== roomCode) {
        socket.emit("room-error", { message: "Unauthorized session. Please rejoin." });
        return;
      }

      if (!validateRoomToken(roomCode, token) || session.token !== token) {
        socket.emit("room-error", { message: "Invalid room token. Please rejoin." });
        return;
      }

      if (!isRoomMember(roomCode, session.userId) && !validateRoomToken(roomCode, token)) {
        socket.emit("room-error", { message: "Forbidden room access." });
        return;
      }

      const room = storage.getRoom(roomCode);
      if (!room) {
        socket.emit("room-error", { message: "Room not found." });
        return;
      }
      if (room.hasPassword && !session.passwordVerified) {
        socket.emit("room-error", { message: "Room password required. Please rejoin." });
        return;
      }

      if (currentRoom) socket.leave(currentRoom);
      currentRoom = roomCode;
      currentSession = session;
      socket.join(roomCode);
      socket.emit("room-message", { type: "clip:history", clips: storage.getClipsByRoom(roomCode) } as RoomMessage);
      io.to(roomCode).emit("room-users", io.sockets.adapter.rooms.get(roomCode)?.size || 0);
    });

    socket.on("send-clip", (data: any) => {
      if (!currentRoom || !currentSession) return;
      const room = storage.getRoom(currentRoom);
      if (!room) return;
      if (room.hasPassword && !currentSession.passwordVerified) return;
      if (!isRoomMember(currentRoom, currentSession.userId) && !validateRoomToken(currentRoom, currentSession.token)) return;
      const clip = storage.createClip(currentRoom, data.content, data.type, data.sourceDevice,
        data.metadata, data.isSensitive, data.burnAfterRead, data.attachments);
      io.to(currentRoom).emit("room-message", { type: "clip:new", clip } as RoomMessage);
    });

    socket.on("update-clip", (data: { clipId: string; content: string; type: string }) => {
      if (!currentRoom || !currentSession) return;
      const room = storage.getRoom(currentRoom);
      if (!room) return;
      if (room.hasPassword && !currentSession.passwordVerified) return;
      if (!isRoomMember(currentRoom, currentSession.userId) && !validateRoomToken(currentRoom, currentSession.token)) return;
      if (storage.updateClip(data.clipId, currentRoom, data.content, data.type)) {
        const clip = storage.getClipsByRoom(currentRoom).find((c) => c.id === data.clipId);
        if (clip) io.to(currentRoom).emit("room-message", { type: "clip:update", clip } as RoomMessage);
      }
    });

    socket.on("delete-clip", (clipId: string) => {
      if (!currentRoom || !currentSession) return;
      const room = storage.getRoom(currentRoom);
      if (!room) return;
      if (room.hasPassword && !currentSession.passwordVerified) return;
      if (!isRoomMember(currentRoom, currentSession.userId) && !validateRoomToken(currentRoom, currentSession.token)) return;
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
