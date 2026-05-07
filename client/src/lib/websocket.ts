/**
 * WebSocket client for NextClip Go backend.
 * Replaces socket.io-client with native WebSocket + JSON message protocol.
 */

export type WSMessageHandler = (msg: any) => void;
export type WSStatusHandler = (connected: boolean) => void;

export interface WSClient {
  connect(url: string): void;
  disconnect(): void;
  send(type: string, data?: any): void;
  onMessage(handler: WSMessageHandler): void;
  onStatus(handler: WSStatusHandler): void;
  isConnected(): boolean;
}

export function createWSClient(): WSClient {
  let ws: WebSocket | null = null;
  let messageHandler: WSMessageHandler | null = null;
  let statusHandler: WSStatusHandler | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let url: string = "";
  let intentionalClose = false;
  let reconnectDelay = 1000;

  function connect(wsUrl: string) {
    url = wsUrl;
    intentionalClose = false;
    reconnectDelay = 1000;
    doConnect();
  }

  function doConnect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      ws.close();
    }

    ws = new WebSocket(url);

    ws.onopen = () => {
      reconnectDelay = 1000;
      statusHandler?.(true);
    };

    ws.onclose = () => {
      statusHandler?.(false);
      if (!intentionalClose) {
        // Auto-reconnect with exponential backoff
        reconnectTimer = setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 1.5, 30000);
          doConnect();
        }, reconnectDelay);
      }
    };

    ws.onerror = () => {
      // Error will trigger onclose
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        messageHandler?.(msg);
      } catch {
        // Ignore malformed messages
      }
    };
  }

  function disconnect() {
    intentionalClose = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      ws.close();
      ws = null;
    }
    statusHandler?.(false);
  }

  function send(type: string, data?: any) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, data }));
    }
  }

  function onMessage(handler: WSMessageHandler) {
    messageHandler = handler;
  }

  function onStatus(handler: WSStatusHandler) {
    statusHandler = handler;
  }

  function isConnectedFn(): boolean {
    return ws?.readyState === WebSocket.OPEN;
  }

  return {
    connect,
    disconnect,
    send,
    onMessage,
    onStatus,
    isConnected: isConnectedFn,
  };
}
