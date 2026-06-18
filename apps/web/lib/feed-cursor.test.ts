import assert from "node:assert/strict";
import test from "node:test";
import { makeFeedCursor, parseFeedCursor } from "./feed-cursor";

const uuid = "550e8400-e29b-41d4-a716-446655440000";

test("parseFeedCursor accepts microsecond Z timestamps without normalizing bytes", () => {
  const timestamp = "2026-06-18T10:00:00.123456Z";
  const result = parseFeedCursor(`${timestamp}|${uuid}`);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.cursor.createdAt, timestamp);
  assert.equal(result.cursor.id, uuid);
});

test("parseFeedCursor accepts microsecond +00:00 timestamps without normalizing bytes", () => {
  const timestamp = "2026-06-18T10:00:00.123456+00:00";
  const result = parseFeedCursor(`${timestamp}|${uuid}`);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.cursor.createdAt, timestamp);
  assert.equal(result.cursor.id, uuid);
});

test("parseFeedCursor rejects malformed delimiters, UUIDs, and timezone-less timestamps", () => {
  const invalid = [
    `2026-06-18T10:00:00.123456Z${uuid}`,
    `2026-06-18T10:00:00.123456Z|${uuid}|extra`,
    "2026-06-18T10:00:00.123456Z|not-a-uuid",
    `2026-06-18T10:00:00.123456|${uuid}`,
  ];

  for (const cursor of invalid) {
    assert.deepEqual(parseFeedCursor(cursor), {
      ok: false,
      error: "Cursor invalido",
    });
  }
});

test("makeFeedCursor preserves timestamp bytes", () => {
  const timestamp = "2026-06-18T10:00:00.123456+00:00";

  assert.equal(makeFeedCursor(timestamp, uuid), `${timestamp}|${uuid}`);
});
