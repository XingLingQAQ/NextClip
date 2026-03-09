import type { Express } from "express";
import type { Server } from "http";
import { Server as SocketIOServer } from "socket.io";
import { storage } from "./storage";
import type { RoomMessage } from "@shared/schema";
import crypto from "crypto";

const VALID_EXPIRY = new Set(["1", "24", "168", "720", "permanent"]);

const roomTokens = new Map<string, Set<string>>();

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
    res.json({ exists: true, hasPassword: room.hasPassword, expiresAt: room.expiresAt, createdAt: room.createdAt });
  });

  app.post("/api/rooms/:roomCode/join", (req, res) => {
    const { roomCode } = req.params;
    const { password } = req.body;
    const room = storage.getRoom(roomCode);

    if (!room) {
      const { expiryHours, userId } = req.body;
      let expiresAt: string | null = null;
      if (expiryHours && expiryHours !== "permanent" && VALID_EXPIRY.has(String(expiryHours))) {
        expiresAt = new Date(Date.now() + parseInt(String(expiryHours)) * 3600000).toISOString();
      } else if (!expiryHours || !VALID_EXPIRY.has(String(expiryHours))) {
        expiresAt = new Date(Date.now() + 24 * 3600000).toISOString();
      }
      const verifiedUserId = userId ? (storage.getUserById(userId) ? userId : null) : null;
      storage.createRoom(roomCode, verifiedUserId || undefined, undefined, expiresAt);
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

  app.post("/api/rooms/:roomCode/password", (req, res) => {
    const { roomCode } = req.params;
    const { password, token } = req.body;
    if (!validateRoomToken(roomCode, token)) {
      return res.status(403).json({ message: "Unauthorized" });
    }
    if (password && (typeof password !== "string" || password.length !== 6)) {
      return res.status(400).json({ message: "Password must be 6 characters" });
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
