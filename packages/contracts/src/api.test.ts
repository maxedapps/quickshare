import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  CreateShareRequest,
  formatContentDigest,
  hexToBytes,
  parseContentDigest,
  parseIfMatch,
  quotedEtag,
  ShareDetail,
  ShareListResponse,
  StartResponse,
  Status,
  UpdateShareRequest,
} from "./api.ts";
import { generateId } from "./ids.ts";
import { decodeListCursor, encodeListCursor } from "./pagination.ts";
import { RootIndexPath } from "./paths.ts";
import { ProblemDetails } from "./problem.ts";

const decode = Schema.decodeUnknownSync;
const id = generateId(() => Uint8Array.from({ length: 16 }, () => 7));

function entry(path: string, size = 12, ordinal = 0) {
  return {
    ordinal,
    path,
    size,
    mediaType: "text/html",
    sha256: "b".repeat(64),
  };
}

describe("api schemas", () => {
  it("maps start/commit statuses", () => {
    expect(Status.start).toBe(202);
    expect(Status.createCommit).toBe(201);
    expect(Status.updateCommit).toBe(200);
    expect(Status.upload).toBe(204);
    expect(Status.stale).toBe(412);
    expect(Status.missingPrecondition).toBe(428);
    expect(Status.conflict).toBe(409);
  });

  it("decodes create and rejects a missing root entry", () => {
    const created = decode(CreateShareRequest)({
      files: [entry(RootIndexPath)],
      access: { kind: "public" },
    });
    expect(created.files[0]?.path).toBe(RootIndexPath);
    expect(() => decode(CreateShareRequest)({ files: [entry("page.html")] })).toThrow();
  });

  it("models update presence: omit retain, null clear, public reset, empty rejected", () => {
    decode(UpdateShareRequest)({ access: { kind: "public" } });
    decode(UpdateShareRequest)({ ttlSeconds: null });
    decode(UpdateShareRequest)({ files: [entry(RootIndexPath)] });
    expect(() => decode(UpdateShareRequest)({})).toThrow();
  });

  it("encodes start, inspect, and list without secrets", () => {
    const start = decode(StartResponse)({
      shareId: id,
      revisionId: id,
      project: "default",
      url: "https://content.workers.dev/default/" + id + "/",
      files: [{ ordinal: 0, path: RootIndexPath, size: 12 }],
    });
    const inspect = decode(ShareDetail)({
      id,
      project: "default",
      status: "active",
      url: start.url,
      revisionId: id,
      createdAt: 1,
      expiresAt: null,
      access: { kind: "public", emailCount: 0 },
      files: [{ path: RootIndexPath, size: 12, mediaType: "text/html" }],
    });
    const list = decode(ShareListResponse)({ items: [], nextCursor: null });
    const encoded = JSON.stringify({ start, inspect, list });
    expect(encoded).not.toContain("password");
    expect(encoded).not.toContain("sha256");
    expect(encoded).not.toContain("digest");
    expect(encoded).not.toContain("salt");
  });

  it("parses quoted If-Match and RFC 9530 digests", () => {
    expect(parseIfMatch(quotedEtag(id))).toBe(id);
    expect(parseIfMatch(id)).toBeUndefined();
    const digest = hexToBytes("cd".repeat(32));
    expect(parseContentDigest(formatContentDigest(digest))).toEqual(digest);
  });

  it("rejects malformed cursors at the contract boundary", () => {
    expect(decodeListCursor("%%%")).toBeUndefined();
    expect(decodeListCursor(encodeListCursor({ createdAt: 1, shareId: id }))).toEqual({
      createdAt: 1,
      shareId: id,
    });
  });

  it("keeps problem details secret-free", () => {
    const body = decode(ProblemDetails)({
      type: "about:blank",
      title: "Not found",
      status: 404,
      code: "not_found",
      requestId: "ray",
    });
    expect(JSON.stringify(body)).not.toContain("password");
  });
});
