-- NextClip D1 Schema (mirrors Go server SQLite schema)

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  room_code TEXT PRIMARY KEY,
  password_hash TEXT,
  owner_id TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clips (
  id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'text',
  timestamp TEXT NOT NULL,
  source_device TEXT NOT NULL DEFAULT 'Unknown',
  metadata TEXT,
  is_sensitive INTEGER NOT NULL DEFAULT 0,
  burn_after_read INTEGER NOT NULL DEFAULT 0,
  attachments TEXT,
  deleted_at TEXT,
  updated_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  idempotency_key TEXT
);

CREATE INDEX IF NOT EXISTS idx_clips_room ON clips(room_code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clips_room_idempotency ON clips(room_code, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS pinned_clips (
  room_code TEXT NOT NULL,
  clip_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(room_code, clip_id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL,
  clip_id TEXT,
  event_type TEXT NOT NULL,
  actor_user_id TEXT,
  actor_device_id TEXT,
  payload TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_room_time ON audit_events(room_code, created_at DESC);

CREATE TABLE IF NOT EXISTS user_sessions (
  sid TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  data TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);
