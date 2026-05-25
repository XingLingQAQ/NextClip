/**
 * Durable Object for WebSocket room management.
 * Each room gets its own DO instance for real-time message broadcasting.
 */
import type { RoomMessage } from "./types";

interface WSSession {
  ws: WebSocket;
  deviceId: string;
  deviceName: string;
}

export class RoomDurableObject {
  private sessions: Map<WebSocket, WSSession> = new Map();
  private state: DurableObjectState;
  private env: any;

  constructor(state: DurableObjectState, env: any) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Internal broadcast endpoint (called from Worker handlers)
    if (url.pathname === "/broadcast") {
      const msg = await request.json() as RoomMessage;
      this.broadcast(msg);
      return new Response("ok");
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

    this.state.acceptWebSocket(server);

    const session: WSSession = { ws: server, deviceId: "", deviceName: "Unknown" };
    this.sessions.set(server, session);

    server.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        const eventType = msg._event || msg.type;
        if (eventType === "join-room") {
          session.deviceId = msg.deviceId || "";
          session.deviceName = msg.deviceName || "Unknown Device";
          this.emitRoomUsers();
        } else if (eventType === "send-clip" || eventType === "update-clip" || eventType === "delete-clip" || eventType === "clear-room" || eventType === "pin-clip") {
          // These are handled via REST API + broadcast; WS is receive-only for now
          // Future: could handle direct WS clip creation here
        }
      } catch {}
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

  private broadcast(msg: RoomMessage) {
    const envelope = JSON.stringify({ type: "room-message", data: msg });
    for (const [ws] of this.sessions) {
      try { ws.send(envelope); } catch {}
    }
  }

  private emitRoomUsers() {
    const count = this.sessions.size;
    const devices = Array.from(this.sessions.values()).map(s => ({
      deviceId: s.deviceId, deviceName: s.deviceName, socketId: "",
    }));

    const countMsg = JSON.stringify({ type: "room-users", data: count });
    const devicesMsg = JSON.stringify({ type: "room-devices", data: devices });

    for (const [ws] of this.sessions) {
      try { ws.send(countMsg); ws.send(devicesMsg); } catch {}
    }
  }
}
