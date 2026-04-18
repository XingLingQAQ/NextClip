import test from "node:test";
import assert from "node:assert/strict";
import session from "express-session";
import { randomUUID } from "node:crypto";
import { SQLiteSessionStore } from "../server/session-store";

test("SQLiteSessionStore set/get/destroy roundtrip", async () => {
  const store = new SQLiteSessionStore();
  const sid = `test-${randomUUID()}`;
  const payload = {
    cookie: {
      expires: new Date(Date.now() + 60_000),
      originalMaxAge: 60_000,
      httpOnly: true,
      path: "/",
    },
    userId: "user-1",
  } as unknown as session.SessionData;

  await new Promise<void>((resolve, reject) => {
    store.set(sid, payload, (err) => (err ? reject(err) : resolve()));
  });

  const got = await new Promise<session.SessionData | null>((resolve, reject) => {
    store.get(sid, (err, data) => (err ? reject(err) : resolve(data || null)));
  });

  assert.equal(got?.userId, "user-1");

  await new Promise<void>((resolve, reject) => {
    store.destroy(sid, (err) => (err ? reject(err) : resolve()));
  });

  const missing = await new Promise<session.SessionData | null>((resolve, reject) => {
    store.get(sid, (err, data) => (err ? reject(err) : resolve(data || null)));
  });
  assert.equal(missing, null);
});

test("SQLiteSessionStore returns null for expired sessions", async () => {
  const store = new SQLiteSessionStore();
  const sid = `test-expired-${randomUUID()}`;
  const payload = {
    cookie: {
      expires: new Date(Date.now() - 60_000),
      originalMaxAge: 60_000,
      httpOnly: true,
      path: "/",
    },
    userId: "user-expired",
  } as unknown as session.SessionData;

  await new Promise<void>((resolve, reject) => {
    store.set(sid, payload, (err) => (err ? reject(err) : resolve()));
  });

  const expired = await new Promise<session.SessionData | null>((resolve, reject) => {
    store.get(sid, (err, data) => (err ? reject(err) : resolve(data || null)));
  });
  assert.equal(expired, null);

  await new Promise<void>((resolve, reject) => {
    store.destroy(sid, (err) => (err ? reject(err) : resolve()));
  });
});
