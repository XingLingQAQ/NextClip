import Database from "better-sqlite3";
import path from "path";
import { type Clip, type RoomInfo, type User } from "@shared/schema";
import { randomUUID } from "crypto";
import crypto from "crypto";

const dbPath = path.resolve(process.cwd(), "clipboard.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    room_code TEXT PRIMARY KEY,
    password_hash TEXT,
    owner_id TEXT,
    expires_at TEXT,
    created_at TEXT NOT NULL
  )
`);

db.exec(`
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
    attachments TEXT
  )
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_clips_room ON clips(room_code)`);

function ensureColumn(table: string, col: string, def: string) {
  const info = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!info.some((c) => c.name === col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }
}
ensureColumn("clips", "metadata", "TEXT");
ensureColumn("clips", "is_sensitive", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("clips", "burn_after_read", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("clips", "attachments", "TEXT");
ensureColumn("rooms", "owner_id", "TEXT");
ensureColumn("rooms", "expires_at", "TEXT");

const HASH_ALGO = "scrypt";
const SCRYPT_N = 1 << 15;
const SCRYPT_R = 8;
const SCRYPT_P = 2;
const SCRYPT_KEYLEN = 64;
const SCRYPT_SALT_BYTES = 16;
const SCRYPT_MAXMEM = 128 * 1024 * 1024;

type PasswordVerification = {
  matched: boolean;
  needsRehash: boolean;
};

/**
 * 新密码参数基线（用于后续统一升级）：
 * - memory cost: N=32768, r=8（约 32MB 级别内存压力）
 * - time cost: N=32768（迭代成本）
 * - parallelism: p=2
 */
function hashPassword(plainText: string): string {
  const salt = crypto.randomBytes(SCRYPT_SALT_BYTES).toString("base64");
  const derived = crypto.scryptSync(plainText, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  }).toString("base64");

  return `${HASH_ALGO}$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${derived}`;
}

function verifyPassword(plainText: string, storedHash: string): PasswordVerification {
  if (storedHash.startsWith(`${HASH_ALGO}$`)) {
    const parts = storedHash.split("$");
    if (parts.length !== 6) return { matched: false, needsRehash: false };

    const [, , nRaw, rRaw, pRaw] = parts;
    const [salt, digest] = [parts[4], parts[5]];
    const n = Number(nRaw);
    const r = Number(rRaw);
    const p = Number(pRaw);
    if (!salt || !digest || !Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) {
      return { matched: false, needsRehash: false };
    }

    const derived = crypto.scryptSync(plainText, salt, SCRYPT_KEYLEN, {
      N: n,
      r,
      p,
      maxmem: SCRYPT_MAXMEM,
    });
    const expected = Buffer.from(digest, "base64");
    if (expected.length !== derived.length) return { matched: false, needsRehash: false };

    return {
      matched: crypto.timingSafeEqual(derived, expected),
      needsRehash: n !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P,
    };
  }

  // 兼容历史 SHA-256（64位 hex）并触发渐进迁移
  const isLegacySha256 = /^[a-f0-9]{64}$/i.test(storedHash);
  if (!isLegacySha256) return { matched: false, needsRehash: false };

  const legacy = crypto.createHash("sha256").update(plainText).digest("hex");
  return { matched: storedHash === legacy, needsRehash: storedHash === legacy };
}

function cleanExpiredRooms() {
  const now = new Date().toISOString();
  const expired = db.prepare(`SELECT room_code FROM rooms WHERE expires_at IS NOT NULL AND expires_at < ?`).all(now) as Array<{ room_code: string }>;
  for (const r of expired) {
    db.prepare(`DELETE FROM clips WHERE room_code = ?`).run(r.room_code);
    db.prepare(`DELETE FROM rooms WHERE room_code = ?`).run(r.room_code);
  }
}

cleanExpiredRooms();
setInterval(cleanExpiredRooms, 60 * 1000);

export const storage = {
  // ===== Users =====
  createUser(username: string, password: string): User {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    db.prepare(`INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)`)
      .run(id, username, hashPassword(password), createdAt);
    return { id, username, createdAt };
  },

  getUser(username: string): (User & { passwordHash: string }) | null {
    const row = db.prepare(`SELECT * FROM users WHERE username = ?`).get(username) as any;
    if (!row) return null;
    return { id: row.id, username: row.username, createdAt: row.created_at, passwordHash: row.password_hash };
  },

  verifyUser(username: string, password: string): User | null {
    const user = this.getUser(username);
    if (!user) return null;
    const result = verifyPassword(password, user.passwordHash);
    if (!result.matched) return null;

    if (result.needsRehash) {
      db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`)
        .run(hashPassword(password), user.id);
    }

    return { id: user.id, username: user.username, createdAt: user.createdAt };
  },

  getUserById(id: string): User | null {
    const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as any;
    if (!row) return null;
    return { id: row.id, username: row.username, createdAt: row.created_at };
  },

  // ===== Rooms =====
  getRoom(roomCode: string): RoomInfo | null {
    const row = db.prepare(`SELECT * FROM rooms WHERE room_code = ?`).get(roomCode) as any;
    if (!row) return null;
    return {
      roomCode: row.room_code,
      hasPassword: !!row.password_hash,
      expiresAt: row.expires_at,
      ownerId: row.owner_id,
      createdAt: row.created_at,
    };
  },

  createRoom(roomCode: string, ownerId?: string, password?: string, expiresAt?: string): RoomInfo {
    db.prepare(`INSERT INTO rooms (room_code, password_hash, owner_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(roomCode, password ? hashPassword(password) : null, ownerId || null, expiresAt || null, new Date().toISOString());
    return { roomCode, hasPassword: !!password, expiresAt: expiresAt || null, ownerId: ownerId || null };
  },

  verifyRoomPassword(roomCode: string, password: string): boolean {
    const row = db.prepare(`SELECT room_code, password_hash FROM rooms WHERE room_code = ?`).get(roomCode) as any;
    if (!row || !row.password_hash) return false;
    const result = verifyPassword(password, row.password_hash);
    if (!result.matched) return false;

    if (result.needsRehash) {
      db.prepare(`UPDATE rooms SET password_hash = ? WHERE room_code = ?`)
        .run(hashPassword(password), row.room_code);
    }

    return true;
  },

  setRoomPassword(roomCode: string, password: string | null): void {
    db.prepare(`UPDATE rooms SET password_hash = ? WHERE room_code = ?`)
      .run(password ? hashPassword(password) : null, roomCode);
  },

  setRoomExpiry(roomCode: string, expiresAt: string | null): void {
    db.prepare(`UPDATE rooms SET expires_at = ? WHERE room_code = ?`).run(expiresAt, roomCode);
  },

  roomExists(roomCode: string): boolean {
    return this.getRoom(roomCode) !== null;
  },

  // ===== Clips =====
  createClip(roomCode: string, content: string, type: string, sourceDevice: string,
    metadata?: string, isSensitive?: boolean, burnAfterRead?: boolean, attachments?: any[]): Clip {
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    const attJson = attachments && attachments.length > 0 ? JSON.stringify(attachments) : null;
    db.prepare(`INSERT INTO clips (id, room_code, content, type, timestamp, source_device, metadata, is_sensitive, burn_after_read, attachments)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, roomCode, content, type, timestamp, sourceDevice, metadata || null, isSensitive ? 1 : 0, burnAfterRead ? 1 : 0, attJson);
    return { id, roomCode, content, type: type as Clip["type"], timestamp, sourceDevice,
      metadata: metadata || undefined, isSensitive: !!isSensitive, burnAfterRead: !!burnAfterRead,
      attachments: attachments || undefined };
  },

  updateClip(id: string, roomCode: string, content: string, type: string): boolean {
    return db.prepare(`UPDATE clips SET content = ?, type = ? WHERE id = ? AND room_code = ?`).run(content, type, id, roomCode).changes > 0;
  },

  getClipsByRoom(roomCode: string): Clip[] {
    const rows = db.prepare(`SELECT * FROM clips WHERE room_code = ? ORDER BY timestamp DESC LIMIT 200`).all(roomCode) as any[];
    return rows.map((r) => ({
      id: r.id, roomCode: r.room_code, content: r.content, type: r.type, timestamp: r.timestamp,
      sourceDevice: r.source_device, metadata: r.metadata || undefined,
      isSensitive: r.is_sensitive === 1, burnAfterRead: r.burn_after_read === 1,
      attachments: r.attachments ? JSON.parse(r.attachments) : undefined,
    }));
  },

  deleteClip(id: string, roomCode: string): boolean {
    return db.prepare(`DELETE FROM clips WHERE id = ? AND room_code = ?`).run(id, roomCode).changes > 0;
  },

  clearRoom(roomCode: string): number {
    return db.prepare(`DELETE FROM clips WHERE room_code = ?`).run(roomCode).changes;
  },
};
