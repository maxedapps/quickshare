import { McpServer } from "@modelcontextprotocol/server";
import * as Schema from "effect/Schema";
import {
  AccessPolicy,
  CanonicalPath,
  Id,
  Limits,
  ProjectSlug,
  TtlSeconds,
  type ShareDetail,
  type ShareListResponse,
} from "@quickshare/contracts";

import type { ShareOperations } from "./operations.ts";

const InlineFile = Schema.Struct({
  path: CanonicalPath,
  content: Schema.String,
  encoding: Schema.optionalKey(Schema.Literals(["utf8", "base64"])),
  mediaType: Schema.optionalKey(Schema.String),
});

export const ShareInput = Schema.Struct({
  shareId: Schema.optionalKey(Id),
  project: Schema.optionalKey(ProjectSlug),
  files: Schema.optionalKey(
    Schema.Array(InlineFile).check(Schema.isMinLength(1), Schema.isMaxLength(Limits.mcpMaxFiles)),
  ),
  ttlSeconds: Schema.optionalKey(Schema.NullOr(TtlSeconds)),
  access: Schema.optionalKey(AccessPolicy),
}).check(
  Schema.makeFilter(
    (value: {
      readonly shareId?: string;
      readonly project?: string;
      readonly files?: ReadonlyArray<{ readonly path: string }>;
      readonly ttlSeconds?: number | null;
      readonly access?: AccessPolicy;
    }) => {
      if (value.shareId === undefined) {
        return value.files !== undefined && value.ttlSeconds !== null;
      }
      if (value.project !== undefined) return false;
      return (
        value.files !== undefined || value.ttlSeconds !== undefined || value.access !== undefined
      );
    },
    {
      message:
        "create requires files; update forbids project and requires files, ttlSeconds, or access",
    },
  ),
);

const ListInput = Schema.Struct({
  project: Schema.optionalKey(ProjectSlug),
  limit: Schema.optionalKey(Schema.Int),
  cursor: Schema.optionalKey(Schema.String),
});

const IdInput = Schema.Struct({
  shareId: Id,
});

export function createMcpServer(operations: ShareOperations): McpServer {
  const server = new McpServer({ name: "quickshare", version: "0.0.0" });
  server.registerTool(
    "share",
    {
      description: "Create or update a share. Omit shareId to create.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async (raw) => {
      const input = Schema.decodeUnknownSync(ShareInput)(raw);
      return result(await operations.share(input));
    },
  );
  server.registerTool(
    "list",
    {
      description: "List shares",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (raw) => {
      const input = Schema.decodeUnknownSync(ListInput)(raw);
      return result(await operations.list(input));
    },
  );
  server.registerTool(
    "inspect",
    {
      description: "Inspect a share",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (raw) => {
      const input = Schema.decodeUnknownSync(IdInput)(raw);
      return result(await operations.inspect(input.shareId));
    },
  );
  server.registerTool(
    "revoke",
    {
      description: "Revoke a share",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async (raw) => {
      const input = Schema.decodeUnknownSync(IdInput)(raw);
      return result(await operations.revoke(input.shareId));
    },
  );
  return server;
}

function result(value: { readonly ok?: true } | ShareListResponse | ShareDetail) {
  return {
    structuredContent: value,
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  };
}
