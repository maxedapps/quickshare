import type {
  CreateShareRequest,
  ManifestEntry,
  ShareDetail,
  ShareListResponse,
  ShareStatus,
  ShareSummary,
  StartResponse,
  UpdateShareRequest,
} from "@quickshare/contracts";
import {
  DefaultProject,
  generateId,
  hexToBytes,
  isRootIndex,
  Limits,
  parseContentDigest,
  ProblemCodes,
  ShareDetail as ShareDetailSchema,
} from "@quickshare/contracts";
import * as Schema from "effect/Schema";

import { accessEmailCount, hashPolicy } from "./access.ts";
import type { ApiEnv } from "./env.ts";
import * as Store from "./storage.ts";
import { visitorUrl } from "./urls.ts";

export class ApiError {
  readonly _tag = "ApiError";
  constructor(
    readonly status: number,
    readonly code: import("@quickshare/contracts").ProblemCode,
    readonly title: string,
    readonly detail?: string,
  ) {}
}

export function shareStatus(share: Store.ShareRow, now: number): ShareStatus {
  if (share.lifecycle === "revoked") return "revoked";
  if (share.expires_at !== null && share.expires_at <= now) return "expired";
  return "active";
}

function toSummary(
  env: ApiEnv,
  share: Store.ShareRow,
  revision: Store.RevisionRow,
  access: Store.AccessRow,
): ShareSummary {
  return {
    id: share.id,
    project: share.project,
    status: shareStatus(share, env.now()),
    url: visitorUrl(env.contentBaseUrl, env.contentDomain, share.project, share.id),
    revisionId: revision.id,
    createdAt: share.created_at,
    expiresAt: share.expires_at,
    access: { kind: access.kind, emailCount: access.email_count },
  };
}

async function toDetail(
  env: ApiEnv,
  share: Store.ShareRow,
  revision: Store.RevisionRow,
): Promise<ShareDetail> {
  const access = await Store.getAccess(env.db, revision.access_policy_id);
  const files = await Store.getFiles(env.db, revision.content_version_id);
  if (access === null) throw new ApiError(500, ProblemCodes.internal, "Internal error");
  return {
    ...toSummary(env, share, revision, access),
    files: files.map((file) => ({ path: file.path, size: file.size, mediaType: file.media_type })),
  };
}

export async function startCreate(env: ApiEnv, body: CreateShareRequest): Promise<StartResponse> {
  const access = body.access ?? { kind: "public" };
  const project = body.project ?? DefaultProject;
  const now = env.now();
  for (let attempt = 0; attempt < 3; attempt++) {
    const shareId = generateId(env.randomBytes);
    const revisionId = generateId(env.randomBytes);
    const contentVersionId = generateId(env.randomBytes);
    const accessPolicyId = generateId(env.randomBytes);
    const credentials = await hashPolicy(access, env.randomBytes);
    try {
      await Store.insertPending(env.db, {
        createShare: true,
        share: {
          id: shareId,
          project,
          created_at: now,
          current_revision_id: null,
          lifecycle: "draft",
          expires_at: null,
          revoked_at: null,
          cleanup_after: null,
        },
        revision: {
          id: revisionId,
          share_id: shareId,
          lifecycle: "pending",
          base_revision_id: null,
          content_version_id: contentVersionId,
          access_policy_id: accessPolicyId,
          expires_at: null,
          ttl_mode: body.ttlSeconds === undefined ? "omit" : "set",
          ttl_seconds: body.ttlSeconds ?? null,
          started_at: now,
          cleanup_at: now + Limits.pendingTtlMs,
          commit_status: null,
          commit_body: null,
          activated_at: null,
        },
        contentVersionId,
        fileCount: body.files.length,
        totalBytes: body.files.reduce((sum, file) => sum + file.size, 0),
        files: manifestRows(contentVersionId, body.files),
        access: { id: accessPolicyId, kind: access.kind, email_count: accessEmailCount(access) },
        credentials,
        reuseContent: false,
        reuseAccess: false,
      });
      return startResponse(env, shareId, revisionId, project, body.files);
    } catch (cause) {
      if (attempt === 2) throw cause;
    }
  }
  throw new ApiError(500, ProblemCodes.internal, "Internal error");
}

export async function startUpdate(
  env: ApiEnv,
  shareId: string,
  ifMatch: string | undefined,
  body: UpdateShareRequest,
): Promise<StartResponse> {
  if (ifMatch === undefined) {
    throw new ApiError(
      428,
      ProblemCodes.precondition_required,
      "If-Match required",
      "quoted current revision ETag is required",
    );
  }
  const share = await Store.getShare(env.db, shareId);
  if (share === null || share.current_revision_id === null) {
    throw new ApiError(404, ProblemCodes.not_found, "Not found");
  }
  const current = await Store.getRevision(env.db, share.current_revision_id);
  if (current === null) throw new ApiError(404, ProblemCodes.not_found, "Not found");
  if (share.lifecycle === "revoked") {
    throw new ApiError(
      409,
      ProblemCodes.share_revoked,
      "Share revoked",
      "revoked shares cannot be updated",
    );
  }
  const now = env.now();
  const expired = share.expires_at !== null && share.expires_at <= now;
  if (expired) {
    const deadline = (share.expires_at ?? 0) + Limits.recoveryWindowMs;
    if (now >= deadline) {
      throw new ApiError(409, ProblemCodes.recovery_window_ended, "Recovery window ended");
    }
    if (body.ttlSeconds === undefined) {
      throw new ApiError(
        409,
        ProblemCodes.share_expired,
        "Share expired",
        "supply ttlSeconds null or a new TTL to revive this share before the recovery window ends",
      );
    }
  }
  if (ifMatch !== current.id) {
    throw new ApiError(
      412,
      ProblemCodes.precondition_failed,
      "Precondition failed",
      "If-Match does not match the current revision",
    );
  }

  const files =
    body.files ??
    (await Store.getFiles(env.db, current.content_version_id)).map((file) => ({
      ordinal: file.ordinal,
      path: file.path,
      size: file.size,
      mediaType: file.media_type,
      sha256: file.sha256,
    }));
  const reuseContent = body.files === undefined;
  const access = body.access;
  const reuseAccess = access === undefined;
  const now2 = env.now();
  const contentVersionId = reuseContent ? current.content_version_id : generateId(env.randomBytes);
  const accessPolicyId = reuseAccess ? current.access_policy_id : generateId(env.randomBytes);
  const revisionId = generateId(env.randomBytes);
  const credentials =
    reuseAccess || access === undefined ? [] : await hashPolicy(access, env.randomBytes);
  const accessRow = reuseAccess
    ? await Store.getAccess(env.db, current.access_policy_id)
    : {
        id: accessPolicyId,
        kind: access.kind,
        email_count: accessEmailCount(access),
      };
  if (accessRow === null) throw new ApiError(500, ProblemCodes.internal, "Internal error");

  await Store.insertPending(env.db, {
    createShare: false,
    share,
    revision: {
      id: revisionId,
      share_id: shareId,
      lifecycle: "pending",
      base_revision_id: current.id,
      content_version_id: contentVersionId,
      access_policy_id: accessPolicyId,
      expires_at: null,
      ttl_mode: body.ttlSeconds === undefined ? "omit" : body.ttlSeconds === null ? "clear" : "set",
      ttl_seconds:
        body.ttlSeconds === undefined || body.ttlSeconds === null ? null : body.ttlSeconds,
      started_at: now2,
      cleanup_at: now2 + Limits.pendingTtlMs,
      commit_status: null,
      commit_body: null,
      activated_at: null,
    },
    contentVersionId,
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    files: reuseContent ? [] : manifestRows(contentVersionId, files),
    access: reuseAccess ? { ...accessRow, id: accessPolicyId } : accessRow,
    credentials,
    reuseContent,
    reuseAccess,
  });
  return startResponse(env, shareId, revisionId, share.project, reuseContent ? [] : files);
}

export async function putFile(
  env: ApiEnv,
  revisionId: string,
  ordinal: number,
  request: Request,
): Promise<void> {
  const pending = await Store.getPending(env.db, revisionId);
  if (
    pending === null ||
    pending.revision.lifecycle !== "pending" ||
    pending.revision.cleanup_at <= env.now()
  ) {
    throw new ApiError(404, ProblemCodes.not_found, "Not found");
  }
  const file = pending.files.find((entry) => entry.ordinal === ordinal);
  if (file === undefined) throw new ApiError(404, ProblemCodes.not_found, "Not found");
  const lengthHeader = request.headers.get("Content-Length");
  if (lengthHeader === null || request.body === null) {
    throw new ApiError(411, ProblemCodes.validation, "Content-Length required");
  }
  const length = Number(lengthHeader);
  if (length !== file.size) {
    throw new ApiError(400, ProblemCodes.validation, "Content-Length mismatch");
  }
  const digest = request.headers.get("Content-Digest");
  if (digest === null) throw new ApiError(400, ProblemCodes.validation, "Content-Digest required");
  const provided = parseContentDigest(digest);
  const expected = hexToBytes(file.sha256);
  if (provided === undefined || provided.length !== expected.length) {
    throw new ApiError(400, ProblemCodes.validation, "Invalid Content-Digest");
  }
  let same = 0;
  for (let i = 0; i < expected.length; i++) same |= (provided[i] ?? 0) ^ (expected[i] ?? 0);
  if (same !== 0) throw new ApiError(400, ProblemCodes.validation, "Content-Digest mismatch");
  if (file.uploaded === 1) return;
  await Store.putObject(
    env.files,
    pending.share.id,
    pending.revision.content_version_id,
    file.path,
    request.body,
    file.size,
    file.media_type,
    expected,
  );
  await Store.markFileUploaded(env.db, pending.revision.content_version_id, ordinal);
}

export async function commit(
  env: ApiEnv,
  revisionId: string,
): Promise<{ readonly status: number; readonly body: ShareDetail }> {
  const pending = await Store.getPending(env.db, revisionId);
  if (pending === null) throw new ApiError(404, ProblemCodes.not_found, "Not found");
  const share = pending.share;
  const alreadyCurrent = share.current_revision_id === revisionId;
  if (
    alreadyCurrent &&
    pending.revision.commit_status !== null &&
    pending.revision.commit_body !== null
  ) {
    return {
      status: pending.revision.commit_status,
      body: Schema.decodeUnknownSync(ShareDetailSchema)(JSON.parse(pending.revision.commit_body)),
    };
  }
  if (alreadyCurrent) {
    if (pending.revision.lifecycle === "pending") {
      await Store.finishRevisionActivation(
        env.db,
        pending.revision.id,
        pending.revision.base_revision_id,
        env.now(),
      );
    }
    const expiresAt = pending.revision.expires_at ?? share.expires_at;
    const activated = {
      ...share,
      current_revision_id: pending.revision.id,
      lifecycle: "active" as const,
      expires_at: expiresAt,
    };
    const status = pending.revision.base_revision_id === null ? 201 : 200;
    const body = await toDetail(env, activated, { ...pending.revision, expires_at: expiresAt });
    await Store.persistCommitResult(env.db, revisionId, status, body, expiresAt);
    return { status, body };
  }
  if (pending.revision.lifecycle !== "pending") {
    throw new ApiError(409, ProblemCodes.conflict, "Revision is not pending");
  }
  if (pending.revision.cleanup_at <= env.now()) {
    throw new ApiError(409, ProblemCodes.conflict, "Upload session expired");
  }
  if (pending.files.some((file) => file.uploaded !== 1) && pending.files.length > 0) {
    throw new ApiError(409, ProblemCodes.conflict, "Incomplete upload");
  }
  if (pending.files.length > 0 && !pending.files.some((file) => isRootIndex(file.path))) {
    throw new ApiError(409, ProblemCodes.conflict, "Root index.html missing");
  }
  if (share.lifecycle === "revoked") {
    throw new ApiError(409, ProblemCodes.share_revoked, "Share revoked");
  }
  const now = env.now();
  if (
    share.expires_at !== null &&
    share.expires_at <= now &&
    now >= share.expires_at + Limits.recoveryWindowMs
  ) {
    throw new ApiError(409, ProblemCodes.recovery_window_ended, "Recovery window ended");
  }
  const expiresAt = await materializedExpiry(env, pending, now);
  const isCreate = pending.revision.base_revision_id === null;
  const status = isCreate ? 201 : 200;
  const ok = await Store.activateRevision(env.db, {
    shareId: share.id,
    newRevisionId: pending.revision.id,
    expectedCurrent: pending.revision.base_revision_id,
    expiresAt,
    now,
  });
  if (!ok) throw new ApiError(409, ProblemCodes.conflict, "Revision conflict");
  const activated = {
    ...share,
    current_revision_id: pending.revision.id,
    lifecycle: "active" as const,
    expires_at: expiresAt,
  };
  const body = await toDetail(env, activated, { ...pending.revision, expires_at: expiresAt });
  await Store.persistCommitResult(env.db, revisionId, status, body, expiresAt);
  return { status, body };
}

async function materializedExpiry(
  env: ApiEnv,
  pending: Store.PendingRevision,
  now: number,
): Promise<number | null> {
  if (pending.revision.ttl_mode === "set") {
    if (pending.revision.expires_at !== null) return pending.revision.expires_at;
    const expiresAt = resolveExpiry(pending.revision, pending.share.expires_at, now);
    await Store.persistExpiry(env.db, pending.revision.id, expiresAt);
    return expiresAt;
  }
  return resolveExpiry(pending.revision, pending.share.expires_at, now);
}

export async function abort(env: ApiEnv, revisionId: string): Promise<void> {
  const revision = await Store.getRevision(env.db, revisionId);
  if (revision === null) throw new ApiError(404, ProblemCodes.not_found, "Not found");
  if (revision.lifecycle === "active") {
    throw new ApiError(409, ProblemCodes.conflict, "Cannot abort an active revision");
  }
  const share = await Store.getShare(env.db, revision.share_id);
  if (share !== null && share.current_revision_id === revisionId) {
    await Store.finishRevisionActivation(env.db, revision.id, revision.base_revision_id, env.now());
    return;
  }
  await Store.abortRevision(env.db, revisionId);
}

export async function inspect(env: ApiEnv, shareId: string): Promise<ShareDetail> {
  const share = await Store.getShare(env.db, shareId);
  if (share === null || share.current_revision_id === null) {
    throw new ApiError(404, ProblemCodes.not_found, "Not found");
  }
  const revision = await Store.getRevision(env.db, share.current_revision_id);
  if (revision === null) throw new ApiError(404, ProblemCodes.not_found, "Not found");
  return toDetail(env, share, revision);
}

export async function listShares(
  env: ApiEnv,
  project: string | undefined,
  limit: number,
  cursor: { readonly createdAt: number; readonly shareId: string } | undefined,
): Promise<ShareListResponse> {
  const rows = await Store.listShares(env.db, project, limit + 1, cursor);
  const page = rows.slice(0, limit);
  const items: ShareSummary[] = [];
  for (const share of page) {
    if (share.current_revision_id === null) continue;
    const revision = await Store.getRevision(env.db, share.current_revision_id);
    const access =
      revision === null ? null : await Store.getAccess(env.db, revision.access_policy_id);
    if (revision === null || access === null) continue;
    items.push(toSummary(env, share, revision, access));
  }
  const last = page[page.length - 1];
  return {
    items,
    nextCursor:
      rows.length > limit && last !== undefined ? encodeCursor(last.created_at, last.id) : null,
  };
}

export async function revoke(env: ApiEnv, shareId: string): Promise<void> {
  const share = await Store.getShare(env.db, shareId);
  if (share === null) throw new ApiError(404, ProblemCodes.not_found, "Not found");
  await Store.revokeShare(env.db, shareId, env.now());
}

function manifestRows(contentVersionId: string, files: ReadonlyArray<ManifestEntry>) {
  return files.map((file) => ({
    content_version_id: contentVersionId,
    path: file.path,
    ordinal: file.ordinal,
    size: file.size,
    media_type: file.mediaType,
    sha256: file.sha256,
  }));
}

function startResponse(
  env: ApiEnv,
  shareId: string,
  revisionId: string,
  project: string,
  files: ReadonlyArray<ManifestEntry>,
): StartResponse {
  return {
    shareId,
    revisionId,
    project,
    url: visitorUrl(env.contentBaseUrl, env.contentDomain, project, shareId),
    files: files.map((file) => ({ ordinal: file.ordinal, path: file.path, size: file.size })),
  };
}

function resolveExpiry(
  revision: Store.RevisionRow,
  currentExpiry: number | null,
  now: number,
): number | null {
  if (revision.ttl_mode === "clear") return null;
  if (revision.ttl_mode === "set" && revision.ttl_seconds !== null)
    return now + revision.ttl_seconds * 1000;
  return currentExpiry;
}

function encodeCursor(createdAt: number, shareId: string): string {
  return btoa(JSON.stringify({ createdAt, shareId }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}
