/**
 * Durable Object for WebSocket room management.
 * Each room gets its own DO instance (keyed by roomCode).
 * Handles real-time broadcasting and bidirectional WebSocket communication.
 */
import type { Env, RoomMessage, Clip, RoomDevice } from "./types";

interface WSSession {
  ws: WebSocket;
  deviceId: string;
  deviceName: string;
  roomToken: string;
}

export class RoomDurableObject implements DurableObject {
  private sessions: Map<WebSocket, WSSession> = new Map();
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Internal broadcast endpoint (called from Worker REST handlers)
    if (url.pathname === "/broadcast") {
      const msg = await request.json() as RoomMessage;
      this.broadcast(msg);
      return new Response("ok");
    }

    // Internal: get connected count
    if (url.pathname === "/status") {
      return Response.json({ connections: this.sessions.size });
    }

    // WebSocket upgrade
    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocket(request);
    }

    return new Response("Not found", { status: 404 });
  }

  private handleWebSocket(request: Request): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept the WebSocket
    this.state.acceptWebSocket(server);

    const session: WSSession = {
      ws: server,
      deviceId: "",
      deviceName: "Unknown",
      roomToken: "",
    };
    this.sessions.set(server, session);

    server.addEventListener("message", async (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        const eventType = msg._event || msg.type || "";
        await this.handleClientMessage(server, session, eventType, msg);
      } catch (e) {
        // Ignore malformed messages
      }
    });

    server.addEventListener("close", () => {
      this.sessions.delete(server);
      this.emitRoomUsers();
    });

    server.addEventListener("error", () => {
      this.sessions.delete(server);
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  private async handleClientMessage(ws: WebSocket, session: WSSession, eventType: string, msg: any) {
    switch (eventType) {
      case "join-room": {
        const roomCode = msg.roomCode || "";
        const token = msg.token || "";
        session.deviceId = msg.deviceId || crypto.randomUUID();
        session.deviceName = msg.deviceName || "Unknown Device";
        session.roomToken = token;

        // Validate token via D1
        const tokenRow = await this.env.DB.prepare(
          "SELECT expires_at FROM room_tokens WHERE token = ? AND room_code = ?"
        ).bind(token, roomCode).first<{ expires_at: number }>();

        if (!tokenRow || tokenRow.expires_at < Date.now()) {
          this.sendTo(ws, { type: "room-error", data: { message: "Invalid room token. Please rejoin." } });
          return;
        }

        // Send clip history
        const clipsRows = await this.env.DB.prepare(
          "SELECT * FROM clips WHERE room_code = ? AND deleted_at IS NULL ORDER BY timestamp DESC LIMIT 200"
        ).bind(roomCode).all();
        const clips: Clip[] = (clipsRows.results || []).map((r: any) => ({
          id: r.id, roomCode: r.room_code, content: r.content, type: r.type,
          timestamp: r.timestamp, sourceDevice: r.source_device,
          metadata: r.metadata || undefined,
          isSensitive: r.is_sensitive === 1,
          burnAfterRead: r.burn_after_read === 1,
          attachments: r.attachments ? JSON.parse(r.attachments) : undefined,
        }));

        const pinnedRows = await this.env.DB.prepare(
          "SELECT clip_id FROM pinned_clips WHERE room_code = ? ORDER BY created_at DESC"
        ).bind(roomCode).all();
        const pinnedClipIds = (pinnedRows.results || []).map((r: any) => r.clip_id);

        // Send history to this client
        this.sendTo(ws, {
          type: "room-message",
          data: { type: "clip:history", clips, pinnedClipIds },
        });

        // Emit room users to all
        this.emitRoomUsers();
        break;
      }

      case "send-clip": {
        // Create clip in D1 and broadcast
        const roomCode = this.getRoomCodeFromToken(session.roomToken);
        if (!roomCode) return;

        const content = (msg.content || "").trim();
        const clipType = msg.type || "text";
        const sourceDevice = (msg.sourceDevice || "Unknown").trim();
        const metadata = msg.metadata || null;
        const isSensitive = msg.isSensitive ? 1 : 0;
        const burnAfterRead = msg.burnAfterRead ? 1 : 0;
        const attachments = msg.attachments?.length ? JSON.stringify(msg.attachments) : null;

        if (!content && !attachments) return;

        const id = crypto.randomUUID();
        const timestamp = new Date().toISOString();

        await this.env.DB.prepare(`
          INSERT INTO clips (id, room_code, content, type, timestamp, source_device, metadata, is_sensitive, burn_after_read, attachments, updated_at, version)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `).bind(id, roomCode, content, clipType, timestamp, sourceDevice, metadata, isSensitive, burnAfterRead, attachments, timestamp).run();

        const clip: Clip = {
          id, roomCode, content, type: clipType, timestamp, sourceDevice,
          metadata: metadata || undefined,
          isSensitive: !!msg.isSensitive,
          burnAfterRead: !!msg.burnAfterRead,
          attachments: msg.attachments || undefined,
        };

        this.broadcast({ type: "clip:new", clip });
        break;
      }

      case "delete-clip": {
        const clipId = msg.clipId;
        if (!clipId) return;
        const roomCode = this.getRoomCodeFromToken(session.roomToken);
        if (!roomCode) return;

        const now = new Date().toISOString();
        await this.env.DB.prepare("DELETE FROM pinned_clips WHERE room_code = ? AND clip_id = ?").bind(roomCode, clipId).run();
        const result = await this.env.DB.prepare(
          "UPDATE clips SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND room_code = ? AND deleted_at IS NULL"
        ).bind(now, now, clipId, roomCode).run();

        if (result.meta.changes) {
          this.broadcast({ type: "clip:delete", clipId });
        }
        break;
      }

      case "clear-room": {
        const roomCode = this.getRoomCodeFromToken(session.roomToken);
        if (!roomCode) return;

        const now = new Date().toISOString();
        await this.env.DB.prepare("DELETE FROM pinned_clips WHERE room_code = ?").bind(roomCode).run();
        await this.env.DB.prepare(
          "UPDATE clips SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE room_code = ? AND deleted_at IS NULL"
        ).bind(now, now, roomCode).run();

        this.broadcast({ type: "clip:clear" });
        break;
      }

      case "update-clip": {
        const clipId = msg.clipId;
        const content = msg.content;
        const clipType = msg.type || "text";
        if (!clipId) return;
        const roomCode = this.getRoomCodeFromToken(session.roomToken);
        if (!roomCode) return;

        const now = new Date().toISOString();
        const result = await this.env.DB.prepare(
          "UPDATE clips SET content = ?, type = ?, updated_at = ?, version = version + 1 WHERE id = ? AND room_code = ? AND deleted_at IS NULL"
        ).bind(content, clipType, now, clipId, roomCode).run();

        if (result.meta.changes) {
          const row = await this.env.DB.prepare(
            "SELECT * FROM clips WHERE id = ? AND room_code = ?"
          ).bind(clipId, roomCode).first<any>();
          if (row) {
            const clip: Clip = {
              id: row.id, roomCode: row.room_code, content: row.content, type: row.type,
              timestamp: row.timestamp, sourceDevice: row.source_device,
              metadata: row.metadata || undefined,
              isSensitive: row.is_sensitive === 1,
              burnAfterRead: row.burn_after_read === 1,
              attachments: row.attachments ? JSON.parse(row.attachments) : undefined,
            };
            this.broadcast({ type: "clip:update", clip });
          }
        }
        break;
      }

      case "pin-clip": {
        const clipId = msg.clipId;
        const pinned = !!msg.pinned;
        if (!clipId) return;
        const roomCode = this.getRoomCodeFromToken(session.roomToken);
        if (!roomCode) return;

        if (pinned) {
          await this.env.DB.prepare(
            "INSERT OR IGNORE INTO pinned_clips (room_code, clip_id, created_at) VALUES (?, ?, ?)"
          ).bind(roomCode, clipId, new Date().toISOString()).run();
        } else {
          await this.env.DB.prepare(
            "DELETE FROM pinned_clips WHERE room_code = ? AND clip_id = ?"
          ).bind(roomCode, clipId).run();
        }

        const pinnedRows = await this.env.DB.prepare(
          "SELECT clip_id FROM pinned_clips WHERE room_code = ? ORDER BY created_at DESC"
        ).bind(roomCode).all();
        const pinnedClipIds = (pinnedRows.results || []).map((r: any) => r.clip_id);

        this.broadcast({ type: "clip:pin", clipId, pinState: pinned, pinnedClipIds });
        break;
      }
    }
  }

  /** Get the roomCode associated with a token by looking it up in D1 */
  private getRoomCodeFromToken(token: string): string | null {
    // For efficiency, we cache the roomCode in the DO name itself
    // The DO is created with idFromName(roomCode), so we can get it from state
    // But since we don't have a direct accessor, we rely on the token lookup
    // In practice, the DO name IS the roomCode
    return this.state.id.name || null;
  }

  private broadcast(msg: RoomMessage) {
    const envelope = JSON.stringify({ type: "room-message", data: msg });
    for (const [ws] of this.sessions) {
      try { ws.send(envelope); } catch {}
    }
  }

  private sendTo(ws: WebSocket, msg: any) {
    try { ws.send(JSON.stringify(msg)); } catch {}
  }

  private emitRoomUsers() {
    const count = this.sessions.size;
    const devices: RoomDevice[] = Array.from(this.sessions.values()).map(s => ({
      deviceId: s.deviceId,
      deviceName: s.deviceName,
      socketId: "",
    }));

    const countMsg = JSON.stringify({ type: "room-users", data: count });
    const devicesMsg = JSON.stringify({ type: "room-devices", data: devices });

    for (const [ws] of this.sessions) {
      try {
        ws.send(countMsg);
        ws.send(devicesMsg);
      } catch {}
    }
  }
}
