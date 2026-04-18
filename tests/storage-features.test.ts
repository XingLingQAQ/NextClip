import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { storage } from "../server/storage";

test("createClip idempotency key deduplicates duplicate submissions", () => {
  const roomCode = `room-${randomUUID()}`;
  storage.createRoom(roomCode);
  const key = `idem-${randomUUID()}`;

  const first = storage.createClip(roomCode, "hello", "text", "device-a", undefined, false, false, undefined, key);
  const second = storage.createClip(roomCode, "hello", "text", "device-a", undefined, false, false, undefined, key);

  assert.equal(first.id, second.id);
  const clips = storage.getClipsByRoom(roomCode);
  assert.equal(clips.length, 1);
});

test("soft delete and restore clip lifecycle", () => {
  const roomCode = `room-${randomUUID()}`;
  storage.createRoom(roomCode);
  const clip = storage.createClip(roomCode, "to delete", "text", "device-a");

  assert.equal(storage.getClipsByRoom(roomCode).some((c) => c.id === clip.id), true);
  assert.equal(storage.deleteClip(clip.id, roomCode), true);
  assert.equal(storage.getClipsByRoom(roomCode).some((c) => c.id === clip.id), false);

  assert.equal(storage.restoreClip(clip.id, roomCode), true);
  assert.equal(storage.getClipsByRoom(roomCode).some((c) => c.id === clip.id), true);
});

test("audit events are recorded and queryable", () => {
  const roomCode = `room-${randomUUID()}`;
  storage.createRoom(roomCode);
  const clip = storage.createClip(roomCode, "audit", "text", "device-a");
  storage.addAuditEvent(roomCode, "clip:create", clip.id, "user-1", "device-1", { via: "test" });

  const events = storage.getAuditEvents(roomCode, 10);
  assert.equal(events.length >= 1, true);
  assert.equal(events[0].eventType, "clip:create");
});
