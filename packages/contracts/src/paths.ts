import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import * as SchemaIssue from "effect/SchemaIssue";

import { Limits } from "./limits.ts";

const ControlOrNul = /[\u0000-\u001f\u007f]/u;

export type CanonicalPathError =
  | "empty"
  | "absolute"
  | "backslash"
  | "control"
  | "dot_segment"
  | "encoded_separator"
  | "reserved"
  | "too_long"
  | "segment_too_long";

export type CanonicalizeResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly error: CanonicalPathError };

const pathErrorMessage = {
  empty: "empty path",
  absolute: "path must be relative",
  backslash: "path must use POSIX separators",
  control: "path contains control characters",
  dot_segment: "path contains empty or dot segments",
  encoded_separator: "path contains encoded separators",
  reserved: "first path segment is reserved",
  too_long: "path exceeds 768 UTF-8 bytes",
  segment_too_long: "path segment exceeds 255 UTF-8 bytes",
};

export function canonicalizePath(raw: string): CanonicalizeResult {
  if (raw.length === 0) return { ok: false, error: "empty" };
  if (raw.startsWith("/")) return { ok: false, error: "absolute" };
  if (raw.includes("\\")) return { ok: false, error: "backslash" };
  if (ControlOrNul.test(raw)) return { ok: false, error: "control" };
  if (raw.includes("%2f") || raw.includes("%2F") || raw.includes("%5c") || raw.includes("%5C")) {
    return { ok: false, error: "encoded_separator" };
  }

  const normalized = raw.normalize("NFC");
  const segments = normalized.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return { ok: false, error: "dot_segment" };
  }
  if (segments[0] === Limits.reservedPathSegment) return { ok: false, error: "reserved" };

  const encoded = new TextEncoder();
  if (encoded.encode(normalized).byteLength > Limits.pathMaxBytes)
    return { ok: false, error: "too_long" };
  for (const segment of segments) {
    if (encoded.encode(segment).byteLength > Limits.pathSegmentMaxBytes) {
      return { ok: false, error: "segment_too_long" };
    }
  }
  return { ok: true, path: normalized };
}

export const CanonicalPath = Schema.String.pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transformOrFail((value) => {
      const result = canonicalizePath(value);
      if (!result.ok) {
        return Effect.fail(
          new SchemaIssue.InvalidValue({ message: pathErrorMessage[result.error] }, result.error),
        );
      }
      return Effect.succeed(result.path);
    }),
    encode: SchemaGetter.passthrough(),
  }),
);
export type CanonicalPath = typeof CanonicalPath.Type;

export const RootIndexPath = "index.html";

export function isRootIndex(path: string): boolean {
  return path === RootIndexPath;
}
