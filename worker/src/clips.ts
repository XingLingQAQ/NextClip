import { Hono } from "hono";
import type { Env, User, Clip } from "./types";
import { generateId } from "./crypto";
import { validateRoomToken } from "./token-store";

const clips = new Hono<{ Bindings: Env; Variables: { user?: User } }>();

function getRoomToken(c: any): string {
  return c.req.header("X-Room-Token") || c.req.query("token") || "";
}

function rowToClip(r: any): Clip {
  return {
    id: r.id, roomCode: r.room_code, content: r.content, type: r.type,
    timestamp: r.timestamp, sourceDevice: r.source_device,
    metadata: r.metadata || undefined,
    isSensitive: r.is_sensitive === 1,
    burnAfterRead: r.burn_after_read === 1,
    attachments: r.attachments ? JSON.parse(r.attachments) : undefined,
  };
}

// Create clip
clips.post("/:roomCode/clips", async (c) => {
  const roomCode = c.req.param("roomCode");
  const token = getRoomToken(c);
  if (!token || !(await validateRoomToken(c.env.DB, roomCode, token))) {
    return c.json({ message: "Unauthorized" }, 403);
  }

  const exists = await c.env.DB.prepare("SELECT room_code FROM rooms WHERE room_code = ?").bind(roomCode).first();
  if (!exists) return c.json({ message: "Room not found" }, 404);

  const body = await c.req.json<any>();
  const content = (body.content || "").trim();
  const clipType = body.type || "text";
  const sourceDevice = (body.sourceDevice || "Web Clipper").trim();
  const metadata = body.metadata || null;
  const isSensitive = body.isSensitive ? 1 : 0;
  const burnAfterRead = body.burnAfterRead ? 1 : 0;
  const attachments = body.attachments?.length ? JSON.stringify(body.attachments) : null;

  if (!content && !attachments) return c.json({ message: "Clip content or attachments required" }, 400);

  const id = generateId();
  const timestamp = new Date().toISOString();

  await c.env.DB.prepare(`
    INSERT INTO clips (id, room_code, content, type, timestamp, source_device, metadata, is_sensitive, burn_after_read, attachments, updated_at, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).bind(id, roomCode, content, clipType, timestamp, sourceDevice, metadata, isSensitive, burnAfterRead, attachments, timestamp).run();

  const clip: Clip = {
    id, roomCode, content, type: clipType, timestamp, sourceDevice,
    metadata: metadata || undefined,
    isSensitive: !!body.isSensitive,
    burnAfterRead: !!body.burnAfterRead,
    attachments: body.attachments || undefined,
  };

  // Broadcast via Durable Object (per-room routing)
  const doId = c.env.ROOM.idFromName(roomCode);
  const stub = c.env.ROOM.get(doId);
  await stub.fetch("http://internal/broadcast", {
    method: "POST",
    body: JSON.stringify({ type: "clip:new", clip }),
  });

  return c.json({ success: true, clip });
});

// Get clips
clips.get("/:roomCode/clips", async (c) => {
  const roomCode = c.req.param("roomCode");
  const token = getRoomToken(c);
  if (!token || !(await validateRoomToken(c.env.DB, roomCode, token))) {
    return c.json({ message: "Unauthorized" }, 403);
  }

  const before = c.req.query("before");
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "50"), 1), 200);

  let rows;
  if (before) {
    rows = await c.env.DB.prepare(
      "SELECT * FROM clips WHERE room_code = ? AND deleted_at IS NULL AND timestamp < ? ORDER BY timestamp DESC LIMIT ?"
    ).bind(roomCode, before, limit).all();
  } else {
    rows = await c.env.DB.prepare(
      "SELECT * FROM clips WHERE room_code = ? AND deleted_at IS NULL ORDER BY timestamp DESC LIMIT ?"
    ).bind(roomCode, limit).all();
  }

  const clps = (rows.results || []).map(rowToClip);
  const pinnedRows = await c.env.DB.prepare(
    "SELECT clip_id FROM pinned_clips WHERE room_code = ? ORDER BY created_at DESC"
  ).bind(roomCode).all();
  const pinnedClipIds = (pinnedRows.results || []).map((r: any) => r.clip_id);
  const nextCursor = clps.length > 0 ? clps[clps.length - 1].timestamp : null;

  return c.json({ clips: clps, pinnedClipIds, nextCursor });
});

// Get clips since timestamp
clips.get("/:roomCode/clips/since/:timestamp", async (c) => {
  const roomCode = c.req.param("roomCode");
  const since = c.req.param("timestamp");
  const token = getRoomToken(c);
  if (!token || !(await validateRoomToken(c.env.DB, roomCode, token))) {
    return c.json({ message: "Unauthorized" }, 403);
  }

  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "200"), 1), 500);
  const rows = await c.env.DB.prepare(
    "SELECT * FROM clips WHERE room_code = ? AND deleted_at IS NULL AND timestamp > ? ORDER BY timestamp ASC LIMIT ?"
  ).bind(roomCode, since, limit).all();

  const clps = (rows.results || []).map(rowToClip);
  return c.json({
    clips: clps,
    serverTime: new Date().toISOString(),
    nextCursor: clps.length ? clps[clps.length - 1].timestamp : since,
  });
});

// Delete clip
clips.delete("/:roomCode/clips/:clipId", async (c) => {
  const roomCode = c.req.param("roomCode");
  const clipId = c.req.param("clipId");
  const token = getRoomToken(c);
  if (!token || !(await validateRoomToken(c.env.DB, roomCode, token))) {
    return c.json({ message: "Unauthorized" }, 403);
  }

  const now = new Date().toISOString();
  await c.env.DB.prepare("DELETE FROM pinned_clips WHERE room_code = ? AND clip_id = ?").bind(roomCode, clipId).run();
  const result = await c.env.DB.prepare(
    "UPDATE clips SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND room_code = ? AND deleted_at IS NULL"
  ).bind(now, now, clipId, roomCode).run();

  if (!result.meta.changes) return c.json({ message: "Clip not found" }, 404);

  // Broadcast delete
  const doId = c.env.ROOM.idFromName(roomCode);
  const stub = c.env.ROOM.get(doId);
  await stub.fetch("http://internal/broadcast", {
    method: "POST",
    body: JSON.stringify({ type: "clip:delete", clipId }),
  });

  return c.json({ success: true });
});

// Clear all clips
clips.delete("/:roomCode/clips", async (c) => {
  const roomCode = c.req.param("roomCode");
  const token = getRoomToken(c);
  if (!token || !(await validateRoomToken(c.env.DB, roomCode, token))) {
    return c.json({ message: "Unauthorized" }, 403);
  }

  const now = new Date().toISOString();
  await c.env.DB.prepare("DELETE FROM pinned_clips WHERE room_code = ?").bind(roomCode).run();
  const result = await c.env.DB.prepare(
    "UPDATE clips SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE room_code = ? AND deleted_at IS NULL"
  ).bind(now, now, roomCode).run();

  // Broadcast clear
  const doId = c.env.ROOM.idFromName(roomCode);
  const stub = c.env.ROOM.get(doId);
  await stub.fetch("http://internal/broadcast", {
    method: "POST",
    body: JSON.stringify({ type: "clip:clear" }),
  });

  return c.json({ success: true, deleted: result.meta.changes || 0 });
});

// Restore clip
clips.post("/:roomCode/clips/:clipId/restore", async (c) => {
  const roomCode = c.req.param("roomCode");
  const clipId = c.req.param("clipId");
  const token = getRoomToken(c);
  if (!token || !(await validateRoomToken(c.env.DB, roomCode, token))) {
    return c.json({ message: "Unauthorized" }, 403);
  }

  const now = new Date().toISOString();
  const result = await c.env.DB.prepare(
    "UPDATE clips SET deleted_at = NULL, updated_at = ?, version = version + 1 WHERE id = ? AND room_code = ? AND deleted_at IS NOT NULL"
  ).bind(now, clipId, roomCode).run();

  if (!result.meta.changes) return c.json({ message: "Clip not found or not deleted" }, 404);

  // Fetch restored clip and broadcast
  const row = await c.env.DB.prepare(
    "SELECT * FROM clips WHERE id = ? AND room_code = ?"
  ).bind(clipId, roomCode).first<any>();
  if (row) {
    const doId = c.env.ROOM.idFromName(roomCode);
    const stub = c.env.ROOM.get(doId);
    await stub.fetch("http://internal/broadcast", {
      method: "POST",
      body: JSON.stringify({ type: "clip:new", clip: rowToClip(row) }),
    });
  }

  return c.json({ success: true });
});

// Pin/Unpin
clips.post("/:roomCode/pins/:clipId", async (c) => {
  const roomCode = c.req.param("roomCode");
  const clipId = c.req.param("clipId");
  const token = getRoomToken(c);
  if (!token || !(await validateRoomToken(c.env.DB, roomCode, token))) {
    return c.json({ message: "Unauthorized" }, 403);
  }

  const body = await c.req.json<{ pinned?: boolean }>();
  if (body.pinned) {
    const exists = await c.env.DB.prepare("SELECT 1 FROM clips WHERE id = ? AND room_code = ?").bind(clipId, roomCode).first();
    if (!exists) return c.json({ message: "Clip not found" }, 404);
    await c.env.DB.prepare("INSERT OR IGNORE INTO pinned_clips (room_code, clip_id, created_at) VALUES (?, ?, ?)")
      .bind(roomCode, clipId, new Date().toISOString()).run();
  } else {
    await c.env.DB.prepare("DELETE FROM pinned_clips WHERE room_code = ? AND clip_id = ?").bind(roomCode, clipId).run();
  }

  // Broadcast pin state
  const pinnedRows = await c.env.DB.prepare(
    "SELECT clip_id FROM pinned_clips WHERE room_code = ? ORDER BY created_at DESC"
  ).bind(roomCode).all();
  const pinnedClipIds = (pinnedRows.results || []).map((r: any) => r.clip_id);

  const doId = c.env.ROOM.idFromName(roomCode);
  const stub = c.env.ROOM.get(doId);
  await stub.fetch("http://internal/broadcast", {
    method: "POST",
    body: JSON.stringify({ type: "clip:pin", clipId, pinState: !!body.pinned, pinnedClipIds }),
  });

  return c.json({ success: true, pinned: !!body.pinned });
});

// Audit
clips.get("/:roomCode/audit", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ message: "Unauthorized" }, 401);
  const roomCode = c.req.param("roomCode");
  const token = getRoomToken(c);
  if (!token || !(await validateRoomToken(c.env.DB, roomCode, token))) {
    return c.json({ message: "Unauthorized" }, 403);
  }

  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "100"), 1), 500);
  const rows = await c.env.DB.prepare(
    "SELECT * FROM audit_events WHERE room_code = ? ORDER BY created_at DESC LIMIT ?"
  ).bind(roomCode, limit).all();

  const events = (rows.results || []).map((r: any) => ({
    id: r.id, roomCode: r.room_code, clipId: r.clip_id || null,
    eventType: r.event_type, actorUserId: r.actor_user_id || null,
    actorDeviceId: r.actor_device_id || null,
    payload: r.payload ? JSON.parse(r.payload) : undefined,
    createdAt: r.created_at,
  }));
  return c.json({ events });
});

export default clips;
