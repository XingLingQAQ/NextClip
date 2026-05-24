/**
 * Native WebSocket client that replaces Socket.io for the Go backend.
 * Provides a similar event-based API surface for minimal refactoring.
 */

type EventHandler = (...args: any[]) => void;

interface WSClientOptions {
  url: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export class WSClient {
  private ws: WebSocket | null = null;
  private url: string;
  private listeners: Map<string, Set<EventHandler>> = new Map();
  private reconnectInterval: number;
  private maxReconnectAttempts: number;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private pendingMessages: string[] = [];

  constructor(options: WSClientOptions) {
    this.url = options.url;
    this.reconnectInterval = options.reconnectInterval || 3000;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 10;
  }

  connect(): void {
    this.intentionalClose = false;
    this.reconnectAttempts = 0;

    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.emit_internal("connect");
      // Flush pending messages
      while (this.pendingMessages.length > 0) {
        const msg = this.pendingMessages.shift()!;
        this.ws?.send(msg);
      }
    };

    this.ws.onclose = () => {
      this.emit_internal("disconnect");
      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // Will trigger onclose after
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const type = data.type as string;
        if (!type) return;

        // Handle special multiplexed event types
        if (type === "room-message") {
          this.emit_internal("room-message", data.data);
        } else if (type === "room-users") {
          this.emit_internal("room-users", data.data);
        } else if (type === "room-devices") {
          this.emit_internal("room-devices", data.data);
        } else if (type === "room-error") {
          this.emit_internal("room-error", data.data);
        } else {
          // Generic event
          this.emit_internal(type, data.data);
        }
      } catch {
        // Ignore invalid JSON
      }
    };
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Send a typed message to the server.
   * Mirrors socket.emit(eventName, data) from Socket.io.
   * The event name is sent as "_event" to avoid conflicts with data fields named "type".
   */
  emit(eventName: string, data?: any): void {
    const message = JSON.stringify({ _event: eventName, ...data });
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(message);
    } else {
      this.pendingMessages.push(message);
    }
  }

  /**
   * Register an event listener.
   * Mirrors socket.on(eventName, handler) from Socket.io.
   */
  on(eventName: string, handler: EventHandler): void {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }
    this.listeners.get(eventName)!.add(handler);
  }

  /**
   * Remove an event listener.
   */
  off(eventName: string, handler: EventHandler): void {
    this.listeners.get(eventName)?.delete(handler);
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private emit_internal(eventName: string, ...args: any[]): void {
    const handlers = this.listeners.get(eventName);
    if (handlers) {
      handlers.forEach((handler) => handler(...args));
    }
  }

  private scheduleReconnect(): void {
    if (this.intentionalClose) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;

    this.reconnectAttempts++;
    const delay = this.reconnectInterval * Math.min(this.reconnectAttempts, 5);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }
}

/**
 * Create a WebSocket URL for the Go backend.
 */
export function createWSUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}
