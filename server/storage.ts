import Database from "better-sqlite3";
import path from "path";
import { type Clip } from "@shared/schema";
import { randomUUID } from "crypto";

const dbPath = path.resolve(process.cwd(), "clipboard.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS clips (
    id TEXT PRIMARY KEY,
    room_code TEXT NOT NULL,
    content TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text',
    timestamp TEXT NOT NULL,
    source_device TEXT NOT NULL DEFAULT 'Unknown',
    metadata TEXT,
    is_sensitive INTEGER NOT NULL DEFAULT 0,
    burn_after_read INTEGER NOT NULL DEFAULT 0
  )
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_clips_room ON clips(room_code)`);

const tableInfo = db.prepare("PRAGMA table_info(clips)").all() as Array<{ name: string }>;
const columnNames = new Set(tableInfo.map((c) => c.name));
if (!columnNames.has("metadata")) {
  db.exec("ALTER TABLE clips ADD COLUMN metadata TEXT");
}
if (!columnNames.has("is_sensitive")) {
  db.exec("ALTER TABLE clips ADD COLUMN is_sensitive INTEGER NOT NULL DEFAULT 0");
}
if (!columnNames.has("burn_after_read")) {
  db.exec("ALTER TABLE clips ADD COLUMN burn_after_read INTEGER NOT NULL DEFAULT 0");
}

const insertStmt = db.prepare(
  `INSERT INTO clips (id, room_code, content, type, timestamp, source_device, metadata, is_sensitive, burn_after_read)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const selectByRoomStmt = db.prepare(
  `SELECT * FROM clips WHERE room_code = ? ORDER BY timestamp DESC LIMIT 200`
);
const deleteByIdStmt = db.prepare(
  `DELETE FROM clips WHERE id = ? AND room_code = ?`
);
const deleteByRoomStmt = db.prepare(
  `DELETE FROM clips WHERE room_code = ?`
);

function rowToClip(row: any): Clip {
  return {
    id: row.id,
    roomCode: row.room_code,
    content: row.content,
    type: row.type,
    timestamp: row.timestamp,
    sourceDevice: row.source_device,
    metadata: row.metadata || undefined,
    isSensitive: row.is_sensitive === 1,
    burnAfterRead: row.burn_after_read === 1,
  };
}

export const storage = {
  createClip(
    roomCode: string,
    content: string,
    type: string,
    sourceDevice: string,
    metadata?: string,
    isSensitive?: boolean,
    burnAfterRead?: boolean
  ): Clip {
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    insertStmt.run(
      id, roomCode, content, type, timestamp, sourceDevice,
      metadata || null, isSensitive ? 1 : 0, burnAfterRead ? 1 : 0
    );
    return {
      id, roomCode, content, type: type as Clip["type"], timestamp, sourceDevice,
      metadata: metadata || undefined,
      isSensitive: isSensitive || false,
      burnAfterRead: burnAfterRead || false,
    };
  },

  getClipsByRoom(roomCode: string): Clip[] {
    const rows = selectByRoomStmt.all(roomCode);
    return rows.map(rowToClip);
  },

  deleteClip(id: string, roomCode: string): boolean {
    const result = deleteByIdStmt.run(id, roomCode);
    return result.changes > 0;
  },

  clearRoom(roomCode: string): number {
    const result = deleteByRoomStmt.run(roomCode);
    return result.changes;
  },
};
