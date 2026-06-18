import { z } from "zod";

const uuidSchema = z.string().uuid();
const isoTimestampRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

export function parseFeedCursor(cursor: string): { ok: true; cursor: { createdAt: string; id: string } } | { ok: false; error: string } {
  const parts = cursor.split("|");
  
  if (parts.length !== 2) {
    return { ok: false, error: "Cursor invalido" };
  }

  const [createdAt, id] = parts;
  if (!createdAt || !id) {
    return { ok: false, error: "Cursor invalido" };
  }

  if (!isoTimestampRegex.test(createdAt)) {
    return { ok: false, error: "Cursor invalido" };
  }

  const uuidParse = uuidSchema.safeParse(id);
  if (!uuidParse.success) {
    return { ok: false, error: "Cursor invalido" };
  }

  return { ok: true, cursor: { createdAt, id } };
}

export function makeFeedCursor(createdAt: string, id: string): string {
  return `${createdAt}|${id}`;
}
