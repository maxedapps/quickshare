import { contentObjectKey, Limits } from "@quickshare/contracts";

import type { ApiEnv } from "./env.ts";
import type { FileRow } from "./storage.ts";

const PageSize = 50;

export async function runCleanup(
  env: ApiEnv,
): Promise<{ readonly deletedShares: number; readonly deletedObjects: number }> {
  let deletedShares = 0;
  let deletedObjects = 0;
  const now = env.now();

  deletedObjects += await cleanupRevisions(env, now, "cleanup_ready");
  deletedObjects += await cleanupRevisions(env, now, "pending");
  deletedObjects += await cleanupRevisions(env, now, "superseded");
  deletedShares += await cleanupShares(env, now);
  return { deletedShares, deletedObjects };
}

async function cleanupRevisions(env: ApiEnv, now: number, lifecycle: string): Promise<number> {
  let deleted = 0;
  const rows = await env.db
    .prepare(
      "SELECT id, share_id, content_version_id FROM share_revisions WHERE lifecycle = ? AND cleanup_at <= ? LIMIT ?",
    )
    .bind(lifecycle, now, PageSize)
    .all<{ id: string; share_id: string; content_version_id: string }>();
  for (const revision of rows.results) {
    const current = await env.db
      .prepare("SELECT 1 AS ok FROM shares WHERE id = ? AND current_revision_id = ?")
      .bind(revision.share_id, revision.id)
      .first();
    if (current !== null) continue;
    if (lifecycle === "pending" && now < (await startedDeadline(env, revision.id))) continue;
    const referenced = await env.db
      .prepare(
        "SELECT 1 AS ok FROM share_revisions WHERE content_version_id = ? AND id != ? AND lifecycle IN ('pending', 'active') LIMIT 1",
      )
      .bind(revision.content_version_id, revision.id)
      .first();
    if (referenced === null) {
      const files = await env.db
        .prepare("SELECT * FROM content_files WHERE content_version_id = ?")
        .bind(revision.content_version_id)
        .all<FileRow>();
      const keys = files.results.map((file) =>
        contentObjectKey(revision.share_id, revision.content_version_id, file.path),
      );
      if (keys.length > 0) {
        await env.files.delete(keys);
        deleted += keys.length;
      }
      await env.db
        .prepare("DELETE FROM content_files WHERE content_version_id = ?")
        .bind(revision.content_version_id)
        .run();
      await env.db
        .prepare("DELETE FROM content_versions WHERE id = ?")
        .bind(revision.content_version_id)
        .run();
    }
    const accessReferenced = await env.db
      .prepare(
        "SELECT 1 AS ok FROM share_revisions WHERE access_policy_id = (SELECT access_policy_id FROM share_revisions WHERE id = ?) AND id != ? AND lifecycle IN ('pending', 'active') LIMIT 1",
      )
      .bind(revision.id, revision.id)
      .first();
    if (accessReferenced === null) {
      const policy = await env.db
        .prepare("SELECT access_policy_id FROM share_revisions WHERE id = ?")
        .bind(revision.id)
        .first<{ access_policy_id: string }>();
      if (policy !== null) {
        await env.db
          .prepare("DELETE FROM access_credentials WHERE access_policy_id = ?")
          .bind(policy.access_policy_id)
          .run();
        await env.db
          .prepare("DELETE FROM access_policies WHERE id = ?")
          .bind(policy.access_policy_id)
          .run();
      }
    }
    await env.db.prepare("DELETE FROM share_revisions WHERE id = ?").bind(revision.id).run();
  }
  return deleted;
}

async function cleanupShares(env: ApiEnv, now: number): Promise<number> {
  const rows = await env.db
    .prepare(
      "SELECT id, current_revision_id FROM shares WHERE cleanup_after IS NOT NULL AND cleanup_after <= ? AND (lifecycle = 'revoked' OR (lifecycle = 'active' AND expires_at IS NOT NULL AND expires_at <= ?)) LIMIT ?",
    )
    .bind(now, now - Limits.recoveryWindowMs, PageSize)
    .all<{ id: string; current_revision_id: string | null }>();
  let deleted = 0;
  for (const share of rows.results) {
    const pending = await env.db
      .prepare(
        "SELECT 1 AS ok FROM share_revisions WHERE share_id = ? AND lifecycle = 'pending' LIMIT 1",
      )
      .bind(share.id)
      .first();
    if (pending !== null) continue;
    const revisions = await env.db
      .prepare("SELECT id FROM share_revisions WHERE share_id = ?")
      .bind(share.id)
      .all<{ id: string }>();
    for (const revision of revisions.results) {
      await env.db
        .prepare(
          "UPDATE share_revisions SET lifecycle = 'cleanup_ready', cleanup_at = ? WHERE id = ?",
        )
        .bind(now, revision.id)
        .run();
    }
    await cleanupRevisions(env, now, "cleanup_ready");
    await env.db.prepare("DELETE FROM shares WHERE id = ?").bind(share.id).run();
    deleted += 1;
  }
  return deleted;
}

async function startedDeadline(env: ApiEnv, revisionId: string): Promise<number> {
  const row = await env.db
    .prepare("SELECT cleanup_at FROM share_revisions WHERE id = ?")
    .bind(revisionId)
    .first<{ cleanup_at: number }>();
  return row?.cleanup_at ?? 0;
}
