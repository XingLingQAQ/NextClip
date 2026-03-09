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
    source_device TEXT NOT NULL DEFAULT 'Unknown'
  )
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_clips_room ON clips(room_code)`);

const insertStmt = db.prepare(
  `INSERT INTO clips (id, room_code, content, type, timestamp, source_device) VALUES (?, ?, ?, ?, ?, ?)`
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
  };
}

export const storage = {
  createClip(roomCode: string, content: string, type: string, sourceDevice: string): Clip {
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    insertStmt.run(id, roomCode, content, type, timestamp, sourceDevice);
    return { id, roomCode, content, type: type as Clip["type"], timestamp, sourceDevice };
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
