/** Pending checkpoints only: no accounts, remote writes, or saved editable drafts. */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acknowledgeOnboardingCheckpoint, appendOnboardingCheckpoint,
  createOnboardingJournal, journalStorageKey, parseOnboardingJournal, prepareOnboardingCheckpoint,
} from "../apps/web/lib/onboarding/journal.ts";

const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const user = "synthetic-user-a";
const empty = () => createOnboardingJournal(user, "nombre", "explorar");
const first = () => appendOnboardingCheckpoint(empty(), {
  operationId: A, revision: 12, fromStep: "nombre", nextStep: "foto", camino: "explorar", fields: { nombre: "Nombre confirmado" },
});

test("empty journal retains owner and current view", () => {
  assert.deepEqual(parseOnboardingJournal(JSON.stringify(empty()), user), empty());
  assert.notEqual(journalStorageKey(user), journalStorageKey("synthetic-user-b"));
  assert.equal(parseOnboardingJournal(null, user), null);
});

test("another account cannot replay any pending payload", () => {
  assert.equal(parseOnboardingJournal(JSON.stringify(first()), "synthetic-user-b"), null);
});

test("a checkpoint detaches immutable arrays from later edits", () => {
  const intereses = ["comida"];
  const journal = appendOnboardingCheckpoint(empty(), { operationId: A, revision: 0,
    fromStep: "intereses", nextStep: "ubicacion", camino: "explorar", fields: { intereses } });
  intereses.push("hogar");
  assert.deepEqual(journal.entries[0]!.fields, { intereses: ["comida"] });
  assert.equal(empty().entries.length, 0);
});

test("Omitir carries no editable values, while later checkpoints stay independent", () => {
  const omitted = appendOnboardingCheckpoint(empty(), { operationId: A, revision: 3,
    fromStep: "nombre", nextStep: "foto", camino: "explorar" });
  const continued = appendOnboardingCheckpoint(omitted, { operationId: B, revision: 3,
    fromStep: "descripcion", nextStep: "intereses", camino: "explorar", fields: { bio: "Mi descripción" } });
  assert.deepEqual(continued.entries.map(entry => entry.fields), [{}, { bio: "Mi descripción" }]);
  assert.equal(continued.viewStep, "intereses");
});

test("only the head is prepared with the actual confirmed revision", () => {
  const journal = appendOnboardingCheckpoint(first(), { operationId: B, revision: 12,
    fromStep: "foto", nextStep: "descripcion", camino: "explorar" });
  assert.deepEqual(journal.entries.map(entry => entry.expectedRevision), [null, null]);
  const prepared = prepareOnboardingCheckpoint(journal, 12);
  assert.deepEqual(prepared.entries.map(entry => entry.expectedRevision), [12, null]);
  assert.equal(prepareOnboardingCheckpoint(prepared, 19), prepared, "Lost responses must retry the original expected revision");
  const remaining = acknowledgeOnboardingCheckpoint(prepared, A, 14);
  assert.equal(remaining.baseRevision, 14);
  assert.equal(prepareOnboardingCheckpoint(remaining, 14).entries[0]!.expectedRevision, 14);
  assert.deepEqual(parseOnboardingJournal(JSON.stringify(journal), user), journal);
});

test("a replayed old ACK cannot rebase its descendants onto another session's newer snapshot", () => {
  const queued = appendOnboardingCheckpoint(first(), { operationId: B, revision: 12,
    fromStep: "descripcion", nextStep: "intereses", camino: "explorar", fields: { bio: "Texto pendiente anterior" } });
  const prepared = prepareOnboardingCheckpoint(queued, queued.baseRevision);
  const remaining = acknowledgeOnboardingCheckpoint(prepared, A, 13);
  assert.equal(remaining.baseRevision, 13);
  const nextRequest = prepareOnboardingCheckpoint(remaining, remaining.baseRevision);
  assert.equal(nextRequest.entries[0]!.expectedRevision, 13, "A newer separately-loaded revision 14 must cause a conflict, not an automatic stale overwrite");
});

test("an ACK can remove only the head and preserves all later payloads", () => {
  const journal = appendOnboardingCheckpoint(first(), { operationId: B, revision: 12,
    fromStep: "foto", nextStep: "descripcion", camino: "explorar" });
  assert.throws(() => acknowledgeOnboardingCheckpoint(journal, B), /orden/);
  const remaining = acknowledgeOnboardingCheckpoint(journal, A);
  assert.equal(remaining.entries.length, 1);
  assert.equal(remaining.entries[0]!.operationId, B);
  assert.equal(remaining.entries[0]!.expectedRevision, null);
  assert.equal(journal.entries.length, 2);
  assert.throws(() => acknowledgeOnboardingCheckpoint(remaining, A), /orden/);
});

test("prepared head restoration preserves exactly the request that may already have committed", () => {
  const prepared = prepareOnboardingCheckpoint(first(), 12);
  const restored = parseOnboardingJournal(JSON.stringify(prepared), user)!;
  assert.deepEqual(restored, prepared);
  assert.equal(prepareOnboardingCheckpoint(restored, 27).entries[0]!.expectedRevision, 12);
  assert.throws(() => prepareOnboardingCheckpoint(first(), -1), /versión/);
  assert.throws(() => prepareOnboardingCheckpoint(first(), 1.5), /versión/);
});

test("duplicate operation IDs are rejected before local advance", () => {
  assert.throws(() => appendOnboardingCheckpoint(first(), { operationId: A, revision: 12,
    fromStep: "foto", nextStep: "descripcion", camino: "explorar" }), /preparar/);
});

test("unknown and privileged fields cannot enter a checkpoint", () => {
  for (const fields of [{ es_vendedor: true }, { paso: "listo" }, { camino: "vender" }, { has_seen_onboarding: true }]) {
    assert.throws(() => appendOnboardingCheckpoint(empty(), { operationId: A, revision: 0,
      fromStep: "nombre", nextStep: "foto", camino: "explorar", fields: fields as never }), /datos/);
  }
});

test("malformed, future, or overlong stored queues never replay", () => {
  for (const value of ["{", "null", "[]", JSON.stringify({ ...first(), version: 2 }),
    JSON.stringify({ ...first(), viewStep: "activar" }),
    JSON.stringify({ ...first(), entries: Array.from({ length: 41 }, () => first().entries[0]) })]) {
    assert.equal(parseOnboardingJournal(value, user), null);
  }
});

test("invalid revisions, duplicates, malformed IDs and unknown steps fail restoration", () => {
  for (const patch of [{ expectedRevision: -1 }, { expectedRevision: 1.5 }, { operationId: "not-uuid" },
    { fromStep: "activar" }, { nextStep: "external" }, { camino: "unknown" }, { fields: { nombre: "a".repeat(61) } }]) {
    const journal = first(); journal.entries[0] = { ...journal.entries[0]!, ...patch } as never;
    assert.equal(parseOnboardingJournal(JSON.stringify(journal), user), null);
  }
  const journal = first(); journal.entries.push({ ...journal.entries[0]! });
  assert.equal(parseOnboardingJournal(JSON.stringify(journal), user), null);
  journal.entries[1] = { ...journal.entries[0]!, operationId: B, expectedRevision: 15 };
  assert.equal(parseOnboardingJournal(JSON.stringify(journal), user), null);
});

test("the queue is bounded so offline tapping does not grow storage indefinitely", () => {
  let journal = empty();
  for (let index = 0; index < 40; index++) journal = appendOnboardingCheckpoint(journal, {
    operationId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    revision: 0, fromStep: "nombre", nextStep: "foto", camino: "explorar",
  });
  assert.throws(() => appendOnboardingCheckpoint(journal, { operationId: B, revision: 0,
    fromStep: "nombre", nextStep: "foto", camino: "explorar" }), /pendientes/);
});
