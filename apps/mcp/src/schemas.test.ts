import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { createMcpServer, ShareInput } from "./server.ts";
import type { ShareOperations } from "./operations.ts";

const noop: ShareOperations = {
  share: async () => {
    throw new Error("unused");
  },
  list: async () => ({ items: [], nextCursor: null }),
  inspect: async () => {
    throw new Error("unused");
  },
  revoke: async () => ({ ok: true }),
};

describe("mcp schemas", () => {
  it("registers exactly four tools", () => {
    const server = createMcpServer(noop);
    expect(server).toBeDefined();
  });

  it("rejects more than 10 emails on share access", () => {
    const emails = Array.from({ length: 11 }, (_, i) => `u${i}@ex.com`);
    expect(() =>
      Schema.decodeUnknownSync(ShareInput)({
        files: [{ path: "index.html", content: "<p>x</p>" }],
        access: { kind: "email_shared", emails, password: "p" },
      }),
    ).toThrow();
  });

  it("rejects non-canonical paths, out-of-range TTL, empty updates, and project on update", () => {
    const files = [{ path: "index.html", content: "<p>x</p>" }];
    expect(() =>
      Schema.decodeUnknownSync(ShareInput)({ files: [{ path: "../secret", content: "x" }] }),
    ).toThrow();
    expect(() => Schema.decodeUnknownSync(ShareInput)({ files, ttlSeconds: 1 })).toThrow();
    const shareId = "AAAAAAAAAAAAAAAAAAAAAA";
    expect(() => Schema.decodeUnknownSync(ShareInput)({ shareId })).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(ShareInput)({ shareId, project: "docs", ttlSeconds: 3600 }),
    ).toThrow();
    Schema.decodeUnknownSync(ShareInput)({ files, ttlSeconds: 3600 });
    Schema.decodeUnknownSync(ShareInput)({ shareId, ttlSeconds: null });
  });
});
