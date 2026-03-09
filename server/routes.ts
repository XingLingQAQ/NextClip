import type { Express } from "express";
import type { Server } from "http";
import { Server as SocketIOServer } from "socket.io";
import { storage } from "./storage";
import type { RoomMessage } from "@shared/schema";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const io = new SocketIOServer(httpServer, {
    cors: { origin: "*" },
    path: "/socket.io",
    maxHttpBufferSize: 10 * 1024 * 1024,
  });

  app.get("/api/rooms/:roomCode", (req, res) => {
    const { roomCode } = req.params;
    const exists = storage.roomExists(roomCode);
    res.json({ exists, roomCode });
  });

  app.post("/api/rooms/:roomCode/join", (req, res) => {
    const { roomCode } = req.params;
    const { password } = req.body;

    if (!password || password.length !== 6) {
      return res.status(400).json({ message: "Password must be 6 digits" });
    }

    const exists = storage.roomExists(roomCode);
    if (!exists) {
      storage.createRoom(roomCode, password);
      return res.json({ success: true, created: true });
    }

    const valid = storage.verifyRoomPassword(roomCode, password);
    if (!valid) {
      return res.status(403).json({ message: "Incorrect password" });
    }

    res.json({ success: true, created: false });
  });

  app.get("/api/rooms/:roomCode/clips", (req, res) => {
    const { roomCode } = req.params;
    const clips = storage.getClipsByRoom(roomCode);
    res.json(clips);
  });

  app.delete("/api/rooms/:roomCode/clips/:clipId", (req, res) => {
    const { roomCode, clipId } = req.params;
    const deleted = storage.deleteClip(clipId, roomCode);
    if (!deleted) return res.status(404).json({ message: "Clip not found" });
    res.json({ success: true });
  });

  app.delete("/api/rooms/:roomCode/clips", (req, res) => {
    const { roomCode } = req.params;
    const count = storage.clearRoom(roomCode);
    res.json({ success: true, deleted: count });
  });

  io.on("connection", (socket) => {
    let currentRoom: string | null = null;

    socket.on("join-room", (roomCode: string) => {
      if (currentRoom) socket.leave(currentRoom);
      currentRoom = roomCode;
      socket.join(roomCode);

      const clips = storage.getClipsByRoom(roomCode);
      socket.emit("room-message", { type: "clip:history", clips } as RoomMessage);

      const count = io.sockets.adapter.rooms.get(roomCode)?.size || 0;
      io.to(roomCode).emit("room-users", count);
    });

    socket.on("send-clip", (data: {
      content: string;
      type: string;
      sourceDevice: string;
      metadata?: string;
      isSensitive?: boolean;
      burnAfterRead?: boolean;
      attachments?: any[];
    }) => {
      if (!currentRoom) return;
      const clip = storage.createClip(
        currentRoom, data.content, data.type, data.sourceDevice,
        data.metadata, data.isSensitive, data.burnAfterRead, data.attachments
      );
      io.to(currentRoom).emit("room-message", { type: "clip:new", clip } as RoomMessage);
    });

    socket.on("update-clip", (data: { clipId: string; content: string; type: string }) => {
      if (!currentRoom) return;
      const updated = storage.updateClip(data.clipId, currentRoom, data.content, data.type);
      if (updated) {
        const clips = storage.getClipsByRoom(currentRoom);
        const clip = clips.find(c => c.id === data.clipId);
        if (clip) {
          io.to(currentRoom).emit("room-message", { type: "clip:update", clip } as RoomMessage);
        }
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
      if (currentRoom) {
        const count = io.sockets.adapter.rooms.get(currentRoom)?.size || 0;
        io.to(currentRoom).emit("room-users", count);
      }
    });
  });

  return httpServer;
}
