export interface Attachment {
  name: string;
  mimeType: string;
  data: string;
  size: number;
}

export interface Clip {
  id: string;
  roomCode: string;
  content: string;
  type: 'text' | 'link' | 'code' | 'image' | 'file' | 'mixed';
  timestamp: string;
  sourceDevice: string;
  attachments?: Attachment[];
  metadata?: string;
  isSensitive?: boolean;
  burnAfterRead?: boolean;
}

export interface RoomMessage {
  type: 'clip:new' | 'clip:delete' | 'clip:clear' | 'clip:history' | 'clip:update';
  clip?: Clip;
  clipId?: string;
  clips?: Clip[];
}

export interface RoomInfo {
  roomCode: string;
  hasPassword: boolean;
  expiresAt: string | null;
  ownerId: string | null;
  createdAt?: string;
}

export interface User {
  id: string;
  username: string;
  createdAt: string;
}
