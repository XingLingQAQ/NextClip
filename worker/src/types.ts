export interface Env {
  DB: D1Database;
  ROOM: DurableObjectNamespace;
  SESSION_SECRET: string;
}

export interface Session {
  sid: string;
  userId: string;
  expiresAt: number;
}

export interface User {
  id: string;
  username: string;
  createdAt: string;
}

export interface Clip {
  id: string;
  roomCode: string;
  content: string;
  type: string;
  timestamp: string;
  sourceDevice: string;
  attachments?: Attachment[];
  metadata?: string;
  isSensitive?: boolean;
  burnAfterRead?: boolean;
}

export interface Attachment {
  name: string;
  mimeType: string;
  data: string;
  size: number;
}

export interface RoomInfo {
  roomCode: string;
  hasPassword: boolean;
  expiresAt: string | null;
  ownerId: string | null;
  createdAt: string;
}

export interface RoomMessage {
  type: string;
  clip?: Clip;
  clipId?: string;
  clips?: Clip[];
  pinnedClipIds?: string[];
  pinState?: boolean;
}

export interface RoomDevice {
  deviceId: string;
  deviceName: string;
  socketId: string;
}
