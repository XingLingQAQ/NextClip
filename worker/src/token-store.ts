/**
 * Room token storage backed by D1.
 * Solves the multi-isolate problem where in-memory tokens aren't shared.
 */

const ROOM_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export async function issueRoomToken(db: D1Database, roomCode: string): Promise<string> {
  const token = crypto.randomUUID();
  const expiresAt = Date.now() + ROOM_TOKEN_TTL_MS;
  // Use a lightweight table for tokens
  await db.prepare(
    "INSERT INTO room_tokens (token, room_code, expires_at) VALUES (?, ?, ?)"
  ).bind(token, roomCode, expiresAt).run();
  return token;
}

export async function validateRoomToken(db: D1Database, roomCode: string, token: string): Promise<boolean> {
  if (!token) return false;
  const row = await db.prepare(
    "SELECT expires_at FROM room_tokens WHERE token = ? AND room_code = ?"
  ).bind(token, roomCode).first<{ expires_at: number }>();
  if (!row) return false;
  if (row.expires_at < Date.now()) {
    // Expired, clean up
    await db.prepare("DELETE FROM room_tokens WHERE token = ?").bind(token).run();
    return false;
  }
  return true;
}

export async function revokeRoomTokens(db: D1Database, roomCode: string): Promise<void> {
  await db.prepare("DELETE FROM room_tokens WHERE room_code = ?").bind(roomCode).run();
}
