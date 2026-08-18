import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { AccessPolicy, Email } from "./access.ts";
import {
  ContentManifest,
  CreateShareRequest,
  hexToBytes,
  parseContentDigest,
  UpdateShareRequest,
} from "./api.ts";
import { encodeId, generateId, Id, isId, isProjectSlug, ProjectSlug } from "./ids.ts";
import { Limits } from "./limits.ts";
import { decodeListCursor, encodeListCursor } from "./pagination.ts";
import { canonicalizePath, RootIndexPath } from "./paths.ts";
import { problem, ProblemCodes, ProblemDetails } from "./problem.ts";

const decode = Schema.decodeUnknownSync;

function bytes(fill: number): Uint8Array {
  return Uint8Array.from({ length: Limits.idBytes }, () => fill);
}

function entry(path: string, size = 1, ordinal = 0) {
  return {
    ordinal,
    path,
    size,
    mediaType: "text/html",
    sha256: "a".repeat(64),
  };
}

describe("ids", () => {
  it("encodes 16 bytes as a 22-character unpadded base64url id", () => {
    const id = encodeId(bytes(1));
    expect(id).toHaveLength(Limits.idLength);
    expect(isId(id)).toBe(true);
    decode(Id)(id);
  });

  it("rejects 21 and 23 character ids", () => {
    expect(isId("A".repeat(21))).toBe(false);
    expect(isId("A".repeat(23))).toBe(false);
    expect(() => decode(Id)("A".repeat(21))).toThrow();
    expect(() => decode(Id)("A".repeat(23))).toThrow();
  });

  it("generates ids from injected randomness", () => {
    expect(generateId(bytes)).toBe(encodeId(bytes(Limits.idBytes)));
  });

  it("accepts DNS-label project slugs at 1 and 63 and rejects 0 and 64", () => {
    expect(isProjectSlug("a")).toBe(true);
    expect(isProjectSlug("a".repeat(63))).toBe(true);
    expect(isProjectSlug("")).toBe(false);
    expect(isProjectSlug("a".repeat(64))).toBe(false);
    expect(isProjectSlug("-a")).toBe(false);
    expect(isProjectSlug("a-")).toBe(false);
    expect(isProjectSlug("A")).toBe(false);
    decode(ProjectSlug)("default");
  });
});

describe("canonical paths", () => {
  it("normalizes NFC and accepts a relative posix path", () => {
    expect(canonicalizePath("css/app.css")).toEqual({ ok: true, path: "css/app.css" });
    expect(canonicalizePath("e\u0301")).toEqual({ ok: true, path: "é" });
    expect(canonicalizePath("empty")).toEqual({ ok: true, path: "empty" });
    expect(canonicalizePath("control")).toEqual({ ok: true, path: "control" });
  });

  it("rejects traversal, absolute, reserved, and encoded separators", () => {
    expect(canonicalizePath("/index.html")).toEqual({ ok: false, error: "absolute" });
    expect(canonicalizePath("a\\b")).toEqual({ ok: false, error: "backslash" });
    expect(canonicalizePath("../x")).toEqual({ ok: false, error: "dot_segment" });
    expect(canonicalizePath("a/./b")).toEqual({ ok: false, error: "dot_segment" });
    expect(canonicalizePath("a//b")).toEqual({ ok: false, error: "dot_segment" });
    expect(canonicalizePath(".quickshare/login")).toEqual({ ok: false, error: "reserved" });
    expect(canonicalizePath("a%2Fbc")).toEqual({ ok: false, error: "encoded_separator" });
    expect(canonicalizePath("a\u0000b")).toEqual({ ok: false, error: "control" });
  });

  it("enforces path and segment byte limits", () => {
    expect(canonicalizePath("a".repeat(Limits.pathMaxBytes + 1))).toEqual({
      ok: false,
      error: "too_long",
    });
    expect(canonicalizePath(`${"a".repeat(Limits.pathSegmentMaxBytes + 1)}/b`)).toEqual({
      ok: false,
      error: "segment_too_long",
    });
  });
});

describe("ttl and access", () => {
  it("accepts ttl bounds and rejects out of range", () => {
    decode(CreateShareRequest)({ files: [entry(RootIndexPath)], ttlSeconds: Limits.ttlMinSeconds });
    decode(CreateShareRequest)({ files: [entry(RootIndexPath)], ttlSeconds: Limits.ttlMaxSeconds });
    expect(() =>
      decode(CreateShareRequest)({
        files: [entry(RootIndexPath)],
        ttlSeconds: Limits.ttlMinSeconds - 1,
      }),
    ).toThrow();
    expect(() =>
      decode(CreateShareRequest)({
        files: [entry(RootIndexPath)],
        ttlSeconds: Limits.ttlMaxSeconds + 1,
      }),
    ).toThrow();
  });

  it("treats omitted ttl as retain on update and null as clear", () => {
    decode(UpdateShareRequest)({ ttlSeconds: null });
    decode(UpdateShareRequest)({ ttlSeconds: 3600 });
    expect(() => decode(UpdateShareRequest)({})).toThrow();
  });

  it("normalizes emails and enforces 9/10/11 bounds", () => {
    expect(decode(Email)("  Test@Example.COM ")).toBe("test@example.com");
    const nine = Array.from({ length: 9 }, (_, i) => `u${i}@ex.com`);
    const ten = [...nine, "u9@ex.com"];
    const eleven = [...ten, "u10@ex.com"];
    decode(AccessPolicy)({ kind: "email_shared", emails: nine, password: "p" });
    decode(AccessPolicy)({ kind: "email_shared", emails: ten, password: "p" });
    expect(() =>
      decode(AccessPolicy)({ kind: "email_shared", emails: eleven, password: "p" }),
    ).toThrow();
  });

  it("rejects per-email count mismatch and public/shared unions", () => {
    decode(AccessPolicy)({ kind: "public" });
    decode(AccessPolicy)({ kind: "shared_password", password: "p" });
    decode(AccessPolicy)({
      kind: "per_email",
      emails: ["a@ex.com", "b@ex.com"],
      passwords: ["1", "2"],
    });
    expect(() =>
      decode(AccessPolicy)({
        kind: "per_email",
        emails: ["a@ex.com", "b@ex.com"],
        passwords: ["1"],
      }),
    ).toThrow();
    expect(() => decode(AccessPolicy)({ kind: "shared_password" })).toThrow();
  });
});

describe("manifests", () => {
  it("requires root index.html and unique paths", () => {
    decode(ContentManifest)([entry(RootIndexPath)]);
    expect(() => decode(ContentManifest)([entry("about.html")])).toThrow();
    expect(() =>
      decode(ContentManifest)([entry(RootIndexPath), entry(RootIndexPath, 1, 1)]),
    ).toThrow();
  });

  it("enforces file count and size edges", () => {
    expect(() => decode(ContentManifest)([])).toThrow();
    const tooBig = entry(RootIndexPath, Limits.maxFileBytes + 1);
    expect(() => decode(ContentManifest)([tooBig])).toThrow();
    decode(ContentManifest)([entry(RootIndexPath, Limits.maxFileBytes)]);
  });
});

describe("pagination", () => {
  it("round-trips a cursor payload", () => {
    const payload = { createdAt: 1, shareId: generateId(bytes) };
    expect(decodeListCursor(encodeListCursor(payload))).toEqual(payload);
  });

  it("rejects malformed cursors", () => {
    expect(decodeListCursor("not-base64")).toBeUndefined();
    expect(decodeListCursor("e30")).toBeUndefined();
  });
});

describe("problem details", () => {
  it("encodes secret-free problem details", () => {
    const body = problem(401, "Unauthorized", ProblemCodes.unauthorized, "req-1");
    const encoded = JSON.stringify(Schema.encodeSync(ProblemDetails)(body));
    expect(encoded).toContain('"code":"unauthorized"');
    expect(encoded).not.toContain("password");
    expect(encoded).not.toContain("hash");
    expect(encoded).not.toContain("shares/");
  });
});

describe("rfc9530 digest", () => {
  it("parses a canonical sha-256 content digest", () => {
    const digest = hexToBytes("ab".repeat(32));
    const header = `sha-256=:${btoa(String.fromCharCode(...digest))}:`;
    expect(parseContentDigest(header)).toEqual(digest);
    expect(parseContentDigest("sha-256=bad")).toBeUndefined();
  });
});
