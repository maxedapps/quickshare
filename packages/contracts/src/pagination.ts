import * as Encoding from "effect/Encoding";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { Id } from "./ids.ts";
import { Limits } from "./limits.ts";

export const ListCursorPayload = Schema.Struct({
  createdAt: Schema.Int,
  shareId: Id,
});
export type ListCursorPayload = typeof ListCursorPayload.Type;

export const ListLimit = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: Limits.listMaxLimit }),
);
export type ListLimit = typeof ListLimit.Type;

export function encodeListCursor(payload: ListCursorPayload): string {
  return Encoding.encodeBase64Url(JSON.stringify(payload));
}

export function decodeListCursor(cursor: string): ListCursorPayload | undefined {
  const bytes = Encoding.decodeBase64Url(cursor);
  if (Result.isFailure(bytes)) return undefined;
  const text = new TextDecoder().decode(bytes.success);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const decoded = Schema.decodeUnknownResult(ListCursorPayload)(parsed);
  if (Result.isFailure(decoded)) return undefined;
  return decoded.success;
}
