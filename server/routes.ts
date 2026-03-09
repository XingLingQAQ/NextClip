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
  });

  app.get("/api/rooms/:roomCode/clips", (req, res) => {
    const { roomCode } = req.params;
    if (!roomCode || roomCode.length < 1) {
      return res.status(400).json({ message: "Room code is required" });
    }
    const clips = storage.getClipsByRoom(roomCode);
    res.json(clips);
  });

  app.delete("/api/rooms/:roomCode/clips/:clipId", (req, res) => {
    const { roomCode, clipId } = req.params;
    const deleted = storage.deleteClip(clipId, roomCode);
    if (!deleted) {
      return res.status(404).json({ message: "Clip not found" });
    }
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
      if (currentRoom) {
        socket.leave(currentRoom);
      }
      currentRoom = roomCode;
      socket.join(roomCode);

      const clips = storage.getClipsByRoom(roomCode);
      const msg: RoomMessage = { type: "clip:history", clips };
      socket.emit("room-message", msg);

      const count = io.sockets.adapter.rooms.get(roomCode)?.size || 0;
      io.to(roomCode).emit("room-users", count);
    });

    socket.on("send-clip", (data: { content: string; type: string; sourceDevice: string }) => {
      if (!currentRoom) return;
      const clip = storage.createClip(currentRoom, data.content, data.type, data.sourceDevice);
      const msg: RoomMessage = { type: "clip:new", clip };
      io.to(currentRoom).emit("room-message", msg);
    });

    socket.on("delete-clip", (clipId: string) => {
      if (!currentRoom) return;
      const deleted = storage.deleteClip(clipId, currentRoom);
      if (deleted) {
        const msg: RoomMessage = { type: "clip:delete", clipId };
        io.to(currentRoom).emit("room-message", msg);
      }
    });

    socket.on("clear-room", () => {
      if (!currentRoom) return;
      storage.clearRoom(currentRoom);
      const msg: RoomMessage = { type: "clip:clear" };
      io.to(currentRoom).emit("room-message", msg);
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
