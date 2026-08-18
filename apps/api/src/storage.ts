import { contentObjectKey, Limits, type AccessKind, type ShareDetail } from "@quickshare/contracts";

import type { CredentialRecord } from "./access.ts";

export type ShareLifecycle = "draft" | "active" | "revoked";
export type RevisionLifecycle = "pending" | "active" | "superseded" | "aborted" | "cleanup_ready";
export type TtlMode = "omit" | "set" | "clear";

export interface ShareRow {
  readonly id: string;
  readonly project: string;
  readonly created_at: number;
  readonly current_revision_id: string | null;
  readonly lifecycle: ShareLifecycle;
  readonly expires_at: number | null;
  readonly revoked_at: number | null;
  readonly cleanup_after: number | null;
}

export interface RevisionRow {
  readonly id: string;
  readonly share_id: string;
  readonly lifecycle: RevisionLifecycle;
  readonly base_revision_id: string | null;
  readonly content_version_id: string;
  readonly access_policy_id: string;
  readonly expires_at: number | null;
  readonly ttl_mode: TtlMode;
  readonly ttl_seconds: number | null;
  readonly started_at: number;
  readonly cleanup_at: number;
  readonly commit_status: number | null;
  readonly commit_body: string | null;
  readonly activated_at: number | null;
}

export interface FileRow {
  readonly content_version_id: string;
  readonly path: string;
  readonly ordinal: number;
  readonly size: number;
  readonly media_type: string;
  readonly sha256: string;
  readonly uploaded: number;
}

export interface AccessRow {
  readonly id: string;
  readonly kind: AccessKind;
  readonly email_count: number;
}

export interface PendingRevision {
  readonly share: ShareRow;
  readonly revision: RevisionRow;
  readonly files: ReadonlyArray<FileRow>;
  readonly access: AccessRow;
}

export async function getShare(db: D1Database, shareId: string): Promise<ShareRow | null> {
  return db.prepare("SELECT * FROM shares WHERE id = ?").bind(shareId).first<ShareRow>();
}

export async function getRevision(db: D1Database, revisionId: string): Promise<RevisionRow | null> {
  return db
    .prepare("SELECT * FROM share_revisions WHERE id = ?")
    .bind(revisionId)
    .first<RevisionRow>();
}

export async function getAccess(db: D1Database, accessPolicyId: string): Promise<AccessRow | null> {
  return db
    .prepare("SELECT * FROM access_policies WHERE id = ?")
    .bind(accessPolicyId)
    .first<AccessRow>();
}

export async function getFiles(
  db: D1Database,
  contentVersionId: string,
): Promise<ReadonlyArray<FileRow>> {
  const result = await db
    .prepare("SELECT * FROM content_files WHERE content_version_id = ? ORDER BY ordinal")
    .bind(contentVersionId)
    .all<FileRow>();
  return result.results;
}

export async function getPending(
  db: D1Database,
  revisionId: string,
): Promise<PendingRevision | null> {
  const revision = await getRevision(db, revisionId);
  if (revision === null) return null;
  const share = await getShare(db, revision.share_id);
  const access = await getAccess(db, revision.access_policy_id);
  if (share === null || access === null) return null;
  return { share, revision, files: await getFiles(db, revision.content_version_id), access };
}

export async function insertPending(
  db: D1Database,
  input: {
    readonly share: ShareRow;
    readonly createShare: boolean;
    readonly revision: RevisionRow;
    readonly contentVersionId: string;
    readonly fileCount: number;
    readonly totalBytes: number;
    readonly files: ReadonlyArray<Omit<FileRow, "uploaded">>;
    readonly access: AccessRow;
    readonly credentials: ReadonlyArray<CredentialRecord>;
    readonly reuseContent: boolean;
    readonly reuseAccess: boolean;
  },
): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  if (input.createShare) {
    statements.push(
      db
        .prepare(
          "INSERT INTO shares (id, project, created_at, current_revision_id, lifecycle, expires_at, revoked_at, cleanup_after) VALUES (?, ?, ?, NULL, ?, NULL, NULL, NULL)",
        )
        .bind(input.share.id, input.share.project, input.share.created_at, input.share.lifecycle),
    );
  }
  if (!input.reuseContent) {
    statements.push(
      db
        .prepare("INSERT INTO content_versions (id, file_count, total_bytes) VALUES (?, ?, ?)")
        .bind(input.contentVersionId, input.fileCount, input.totalBytes),
    );
  }
  if (!input.reuseAccess) {
    statements.push(
      db
        .prepare("INSERT INTO access_policies (id, kind, email_count) VALUES (?, ?, ?)")
        .bind(input.access.id, input.access.kind, input.access.email_count),
    );
  }
  for (const file of input.files) {
    statements.push(
      db
        .prepare(
          "INSERT INTO content_files (content_version_id, path, ordinal, size, media_type, sha256, uploaded) VALUES (?, ?, ?, ?, ?, ?, 0)",
        )
        .bind(
          file.content_version_id,
          file.path,
          file.ordinal,
          file.size,
          file.media_type,
          file.sha256,
        ),
    );
  }
  for (const credential of input.credentials) {
    statements.push(
      db
        .prepare(
          "INSERT INTO access_credentials (access_policy_id, principal, algorithm, version, iterations, salt, digest) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          input.access.id,
          credential.principal,
          credential.algorithm,
          credential.version,
          credential.iterations,
          credential.salt,
          credential.digest,
        ),
    );
  }
  statements.push(
    db
      .prepare(
        "INSERT INTO share_revisions (id, share_id, lifecycle, base_revision_id, content_version_id, access_policy_id, expires_at, ttl_mode, ttl_seconds, started_at, cleanup_at, commit_status, commit_body, activated_at) VALUES (?, ?, 'pending', ?, ?, ?, NULL, ?, ?, ?, ?, NULL, NULL, NULL)",
      )
      .bind(
        input.revision.id,
        input.revision.share_id,
        input.revision.base_revision_id,
        input.revision.content_version_id,
        input.revision.access_policy_id,
        input.revision.ttl_mode,
        input.revision.ttl_seconds,
        input.revision.started_at,
        input.revision.cleanup_at,
      ),
  );
  await db.batch(statements);
}

export async function markFileUploaded(
  db: D1Database,
  contentVersionId: string,
  ordinal: number,
): Promise<void> {
  await db
    .prepare("UPDATE content_files SET uploaded = 1 WHERE content_version_id = ? AND ordinal = ?")
    .bind(contentVersionId, ordinal)
    .run();
}

export async function abortRevision(db: D1Database, revisionId: string): Promise<void> {
  await db
    .prepare(
      "UPDATE share_revisions SET lifecycle = 'cleanup_ready' WHERE id = ? AND lifecycle IN ('pending', 'cleanup_ready') AND id NOT IN (SELECT current_revision_id FROM shares WHERE current_revision_id IS NOT NULL)",
    )
    .bind(revisionId)
    .run();
}

export async function persistExpiry(
  db: D1Database,
  revisionId: string,
  expiresAt: number | null,
): Promise<void> {
  await db
    .prepare("UPDATE share_revisions SET expires_at = ? WHERE id = ?")
    .bind(expiresAt, revisionId)
    .run();
}

export async function persistCommitResult(
  db: D1Database,
  revisionId: string,
  status: number,
  body: ShareDetail,
  expiresAt: number | null,
): Promise<void> {
  await db
    .prepare(
      "UPDATE share_revisions SET commit_status = ?, commit_body = ?, expires_at = ? WHERE id = ?",
    )
    .bind(status, JSON.stringify(body), expiresAt, revisionId)
    .run();
}

export async function finishRevisionActivation(
  db: D1Database,
  newRevisionId: string,
  expectedCurrent: string | null,
  now: number,
): Promise<void> {
  const statements = [
    db
      .prepare(
        "UPDATE share_revisions SET lifecycle = 'active', activated_at = ? WHERE id = ? AND lifecycle = 'pending'",
      )
      .bind(now, newRevisionId),
  ];
  if (expectedCurrent !== null) {
    statements.push(
      db
        .prepare("UPDATE share_revisions SET lifecycle = 'superseded', cleanup_at = ? WHERE id = ?")
        .bind(now, expectedCurrent),
    );
  }
  await db.batch(statements);
}

export async function activateRevision(
  db: D1Database,
  input: {
    readonly shareId: string;
    readonly newRevisionId: string;
    readonly expectedCurrent: string | null;
    readonly expiresAt: number | null;
    readonly now: number;
  },
): Promise<boolean> {
  const cleanupAfter = input.expiresAt === null ? null : input.expiresAt + Limits.recoveryWindowMs;
  const shareUpdate = await db
    .prepare(
      input.expectedCurrent === null
        ? "UPDATE shares SET current_revision_id = ?, lifecycle = 'active', expires_at = ?, cleanup_after = ? WHERE id = ? AND current_revision_id IS NULL AND lifecycle = 'draft'"
        : "UPDATE shares SET current_revision_id = ?, lifecycle = 'active', expires_at = ?, cleanup_after = ? WHERE id = ? AND current_revision_id = ? AND lifecycle = 'active'",
    )
    .bind(
      input.newRevisionId,
      input.expiresAt,
      cleanupAfter,
      input.shareId,
      ...(input.expectedCurrent === null ? [] : [input.expectedCurrent]),
    )
    .run();
  if ((shareUpdate.meta.changes ?? 0) !== 1) return false;
  await finishRevisionActivation(db, input.newRevisionId, input.expectedCurrent, input.now);
  return true;
}

export async function revokeShare(
  db: D1Database,
  shareId: string,
  now: number,
): Promise<ShareRow | null> {
  await db
    .prepare(
      "UPDATE shares SET lifecycle = 'revoked', revoked_at = ?, cleanup_after = ? WHERE id = ? AND lifecycle IN ('draft', 'active', 'revoked')",
    )
    .bind(now, now, shareId)
    .run();
  return getShare(db, shareId);
}

export async function listShares(
  db: D1Database,
  project: string | undefined,
  limit: number,
  cursor: { readonly createdAt: number; readonly shareId: string } | undefined,
): Promise<ReadonlyArray<ShareRow>> {
  const filter = project === undefined ? "" : "AND project = ?";
  const cursorSql =
    cursor === undefined ? "" : "AND (created_at < ? OR (created_at = ? AND id < ?))";
  const sql = `SELECT * FROM shares WHERE lifecycle != 'draft' ${filter} ${cursorSql} ORDER BY created_at DESC, id DESC LIMIT ?`;
  const binds: Array<string | number> = [];
  if (project !== undefined) binds.push(project);
  if (cursor !== undefined) binds.push(cursor.createdAt, cursor.createdAt, cursor.shareId);
  binds.push(limit);
  const result = await db
    .prepare(sql)
    .bind(...binds)
    .all<ShareRow>();
  return result.results;
}

export async function putObject(
  files: R2Bucket,
  shareId: string,
  contentVersionId: string,
  path: string,
  body: ReadableStream<Uint8Array>,
  size: number,
  mediaType: string,
  sha256: Uint8Array,
): Promise<R2Object> {
  const object = await files.put(contentObjectKey(shareId, contentVersionId, path), body, {
    httpMetadata: { contentType: mediaType },
    sha256,
  });
  if (object.size !== size) {
    throw new Error("r2 size mismatch");
  }
  return object;
}

export async function deleteObjects(files: R2Bucket, keys: ReadonlyArray<string>): Promise<void> {
  if (keys.length === 0) return;
  await files.delete([...keys]);
}

export { contentObjectKey };
