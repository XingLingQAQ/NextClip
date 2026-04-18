import session from "express-session";
import Database from "better-sqlite3";
import path from "path";

const dbPath = path.resolve(process.cwd(), "clipboard.db");
const db = new Database(dbPath);

// Session storage table for persistent login sessions across server restarts.
db.exec(`
  CREATE TABLE IF NOT EXISTS user_sessions (
    sid TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL,
    data TEXT NOT NULL
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at)`);

function cleanExpiredSessions() {
  db.prepare(`DELETE FROM user_sessions WHERE expires_at < ?`).run(Date.now());
}

cleanExpiredSessions();
setInterval(cleanExpiredSessions, 60 * 1000).unref();

export class SQLiteSessionStore extends session.Store {
  get(sid: string, callback: (err?: any, sessionData?: session.SessionData | null) => void): void {
    try {
      const row = db.prepare(`SELECT data, expires_at FROM user_sessions WHERE sid = ?`).get(sid) as { data: string; expires_at: number } | undefined;
      if (!row || row.expires_at < Date.now()) {
        callback(undefined, null);
        return;
      }
      callback(undefined, JSON.parse(row.data) as session.SessionData);
    } catch (err) {
      callback(err);
    }
  }

  set(sid: string, sessionData: session.SessionData, callback?: (err?: any) => void): void {
    try {
      const expiresAt = typeof sessionData.cookie?.expires === "string"
        ? new Date(sessionData.cookie.expires).getTime()
        : sessionData.cookie?.expires instanceof Date
          ? sessionData.cookie.expires.getTime()
          : Date.now() + 7 * 24 * 60 * 60 * 1000;

      db.prepare(`
        INSERT INTO user_sessions (sid, expires_at, data)
        VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET
          expires_at = excluded.expires_at,
          data = excluded.data
      `).run(sid, expiresAt, JSON.stringify(sessionData));

      if (callback) callback();
    } catch (err) {
      if (callback) callback(err);
    }
  }

  destroy(sid: string, callback?: (err?: any) => void): void {
    try {
      db.prepare(`DELETE FROM user_sessions WHERE sid = ?`).run(sid);
      if (callback) callback();
    } catch (err) {
      if (callback) callback(err);
    }
  }
}
