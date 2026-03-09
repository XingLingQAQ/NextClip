export interface Clip {
  id: string;
  roomCode: string;
  content: string;
  type: 'text' | 'link' | 'code' | 'image';
  timestamp: string;
  sourceDevice: string;
}

export interface RoomMessage {
  type: 'clip:new' | 'clip:delete' | 'clip:clear' | 'clip:history';
  clip?: Clip;
  clipId?: string;
  clips?: Clip[];
  roomCode?: string;
}
