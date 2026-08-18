import { blob, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const shares = sqliteTable(
  "shares",
  {
    id: text("id").primaryKey(),
    project: text("project").notNull(),
    createdAt: integer("created_at").notNull(),
    currentRevisionId: text("current_revision_id"),
    lifecycle: text("lifecycle").notNull(),
    expiresAt: integer("expires_at"),
    revokedAt: integer("revoked_at"),
    cleanupAfter: integer("cleanup_after"),
  },
  (table) => [
    index("shares_list").on(table.createdAt, table.id),
    index("shares_project_list").on(table.project, table.createdAt, table.id),
    index("shares_cleanup").on(table.lifecycle, table.cleanupAfter),
  ],
);

export const contentVersions = sqliteTable("content_versions", {
  id: text("id").primaryKey(),
  fileCount: integer("file_count").notNull(),
  totalBytes: integer("total_bytes").notNull(),
});

export const accessPolicies = sqliteTable("access_policies", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  emailCount: integer("email_count").notNull(),
});

export const shareRevisions = sqliteTable(
  "share_revisions",
  {
    id: text("id").primaryKey(),
    shareId: text("share_id")
      .notNull()
      .references(() => shares.id),
    lifecycle: text("lifecycle").notNull(),
    baseRevisionId: text("base_revision_id"),
    contentVersionId: text("content_version_id")
      .notNull()
      .references(() => contentVersions.id),
    accessPolicyId: text("access_policy_id")
      .notNull()
      .references(() => accessPolicies.id),
    expiresAt: integer("expires_at"),
    ttlMode: text("ttl_mode").notNull(),
    ttlSeconds: integer("ttl_seconds"),
    startedAt: integer("started_at").notNull(),
    cleanupAt: integer("cleanup_at").notNull(),
    commitStatus: integer("commit_status"),
    commitBody: text("commit_body"),
    activatedAt: integer("activated_at"),
  },
  (table) => [
    index("revisions_cleanup").on(table.lifecycle, table.cleanupAt),
    index("revisions_share").on(table.shareId, table.lifecycle),
    index("revisions_content").on(table.contentVersionId),
    index("revisions_access").on(table.accessPolicyId),
  ],
);

export const contentFiles = sqliteTable(
  "content_files",
  {
    contentVersionId: text("content_version_id")
      .notNull()
      .references(() => contentVersions.id),
    path: text("path").notNull(),
    ordinal: integer("ordinal").notNull(),
    size: integer("size").notNull(),
    mediaType: text("media_type").notNull(),
    sha256: text("sha256").notNull(),
    uploaded: integer("uploaded").notNull(),
  },
  (table) => [
    uniqueIndex("content_files_pk").on(table.contentVersionId, table.path),
    uniqueIndex("content_files_ordinal").on(table.contentVersionId, table.ordinal),
  ],
);

export const accessCredentials = sqliteTable(
  "access_credentials",
  {
    accessPolicyId: text("access_policy_id")
      .notNull()
      .references(() => accessPolicies.id),
    principal: text("principal").notNull(),
    algorithm: text("algorithm").notNull(),
    version: integer("version").notNull(),
    iterations: integer("iterations").notNull(),
    salt: blob("salt", { mode: "buffer" }).notNull(),
    digest: blob("digest", { mode: "buffer" }).notNull(),
  },
  (table) => [uniqueIndex("access_credentials_pk").on(table.accessPolicyId, table.principal)],
);
