import * as Schema from "effect/Schema";

import { AccessKind, AccessPolicy } from "./access.ts";
import { Id, ProjectSlug } from "./ids.ts";
import { Limits } from "./limits.ts";
import { CanonicalPath, isRootIndex, RootIndexPath } from "./paths.ts";

export const Routes = {
  health: "/health",
  shares: "/v1/shares",
  share: "/v1/shares/:shareId",
  revisions: "/v1/shares/:shareId/revisions",
  uploadFile: "/v1/uploads/:revisionId/files/:ordinal",
  commit: "/v1/uploads/:revisionId/commit",
  abort: "/v1/uploads/:revisionId",
  mcp: "/mcp",
} as const;

export const Status = {
  start: 202,
  upload: 204,
  abort: 204,
  revoke: 204,
  createCommit: 201,
  updateCommit: 200,
  list: 200,
  inspect: 200,
  stale: 412,
  missingPrecondition: 428,
  conflict: 409,
} as const;

export const Sha256Hex = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
export type Sha256Hex = typeof Sha256Hex.Type;

export const MediaType = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(Limits.mediaTypeMaxBytes),
  Schema.makeFilter((value: string) => !value.includes("\r") && !value.includes("\n"), {
    message: "media type must not contain CR or LF",
  }),
);

export const FileSize = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: Limits.maxFileBytes }),
);

export const ManifestEntry = Schema.Struct({
  ordinal: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  path: CanonicalPath,
  size: FileSize,
  mediaType: MediaType,
  sha256: Sha256Hex,
});
export type ManifestEntry = typeof ManifestEntry.Type;

export const ContentManifest = Schema.Array(ManifestEntry).check(
  Schema.isMinLength(Limits.minFiles),
  Schema.isMaxLength(Limits.maxFiles),
  Schema.makeFilter(
    (entries: ReadonlyArray<ManifestEntry>) => {
      const paths = new Set<string>();
      const ordinals = new Set<number>();
      let total = 0;
      let hasRoot = false;
      for (const entry of entries) {
        if (paths.has(entry.path) || ordinals.has(entry.ordinal)) return false;
        paths.add(entry.path);
        ordinals.add(entry.ordinal);
        total += entry.size;
        if (isRootIndex(entry.path)) hasRoot = true;
      }
      return hasRoot && total <= Limits.maxTotalBytes;
    },
    {
      message: `complete manifest requires unique ${RootIndexPath}, unique ordinals, and total size within limits`,
    },
  ),
);
export type ContentManifest = typeof ContentManifest.Type;

export const TtlSeconds = Schema.Int.check(
  Schema.isBetween({ minimum: Limits.ttlMinSeconds, maximum: Limits.ttlMaxSeconds }),
);
export type TtlSeconds = typeof TtlSeconds.Type;

export const CreateShareRequest = Schema.Struct({
  project: Schema.optionalKey(ProjectSlug),
  files: ContentManifest,
  ttlSeconds: Schema.optionalKey(TtlSeconds),
  access: Schema.optionalKey(AccessPolicy),
});
export type CreateShareRequest = typeof CreateShareRequest.Type;

export const UpdateShareRequest = Schema.Struct({
  files: Schema.optionalKey(ContentManifest),
  ttlSeconds: Schema.optionalKey(Schema.NullOr(TtlSeconds)),
  access: Schema.optionalKey(AccessPolicy),
}).check(
  Schema.makeFilter(
    (value: {
      readonly files?: ContentManifest;
      readonly ttlSeconds?: number | null;
      readonly access?: AccessPolicy;
    }) => value.files !== undefined || value.ttlSeconds !== undefined || value.access !== undefined,
    { message: "update must include content, ttlSeconds, or access" },
  ),
);
export type UpdateShareRequest = typeof UpdateShareRequest.Type;

export const ShareStatus = Schema.Literals(["active", "expired", "revoked"]);
export type ShareStatus = typeof ShareStatus.Type;

export const AccessSummary = Schema.Struct({
  kind: AccessKind,
  emailCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type AccessSummary = typeof AccessSummary.Type;

export const FileSummary = Schema.Struct({
  path: CanonicalPath,
  size: FileSize,
  mediaType: MediaType,
});
export type FileSummary = typeof FileSummary.Type;

export const ShareSummary = Schema.Struct({
  id: Id,
  project: ProjectSlug,
  status: ShareStatus,
  url: Schema.String,
  revisionId: Id,
  createdAt: Schema.Int,
  expiresAt: Schema.NullOr(Schema.Int),
  access: AccessSummary,
});
export type ShareSummary = typeof ShareSummary.Type;

export const ShareDetail = Schema.Struct({
  id: Id,
  project: ProjectSlug,
  status: ShareStatus,
  url: Schema.String,
  revisionId: Id,
  createdAt: Schema.Int,
  expiresAt: Schema.NullOr(Schema.Int),
  access: AccessSummary,
  files: Schema.Array(FileSummary),
});
export type ShareDetail = typeof ShareDetail.Type;

export const StartResponse = Schema.Struct({
  shareId: Id,
  revisionId: Id,
  project: ProjectSlug,
  url: Schema.String,
  files: Schema.Array(
    Schema.Struct({
      ordinal: Schema.Int,
      path: CanonicalPath,
      size: FileSize,
    }),
  ),
});
export type StartResponse = typeof StartResponse.Type;

export const ShareListResponse = Schema.Struct({
  items: Schema.Array(ShareSummary),
  nextCursor: Schema.NullOr(Schema.String),
});
export type ShareListResponse = typeof ShareListResponse.Type;

export const ContentDigestPattern = /^sha-256=:([A-Za-z0-9+/]{43}=):$/;

export function parseContentDigest(header: string): Uint8Array | undefined {
  const match = ContentDigestPattern.exec(header);
  if (match === null || match[1] === undefined) return undefined;
  const binary = atob(match[1]);
  if (binary.length !== 32) return undefined;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function formatContentDigest(sha256: Uint8Array): string {
  let binary = "";
  for (const byte of sha256) {
    binary += String.fromCharCode(byte);
  }
  return `sha-256=:${btoa(binary)}:`;
}

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

export function quotedEtag(revisionId: string): string {
  return `"${revisionId}"`;
}

export function parseIfMatch(header: string): string | undefined {
  const match = /^"([A-Za-z0-9_-]{22})"$/.exec(header);
  return match?.[1];
}

export const IfMatchHeader = "If-Match";
export const ContentDigestHeader = "Content-Digest";
export const AuthorizationHeader = "Authorization";
