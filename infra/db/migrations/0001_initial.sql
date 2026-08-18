CREATE TABLE shares (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 22),
  project TEXT NOT NULL CHECK (length(project) BETWEEN 1 AND 63),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  current_revision_id TEXT CHECK (current_revision_id IS NULL OR length(current_revision_id) = 22),
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('draft', 'active', 'revoked')),
  expires_at INTEGER CHECK (expires_at IS NULL OR expires_at >= 0),
  revoked_at INTEGER CHECK (revoked_at IS NULL OR revoked_at >= 0),
  cleanup_after INTEGER CHECK (cleanup_after IS NULL OR cleanup_after >= 0)
);

CREATE TABLE content_versions (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 22),
  file_count INTEGER NOT NULL CHECK (file_count >= 0),
  total_bytes INTEGER NOT NULL CHECK (total_bytes >= 0)
);

CREATE TABLE access_policies (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 22),
  kind TEXT NOT NULL CHECK (kind IN ('public', 'shared_password', 'email_shared', 'per_email')),
  email_count INTEGER NOT NULL CHECK (email_count >= 0)
);

CREATE TABLE share_revisions (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 22),
  share_id TEXT NOT NULL REFERENCES shares(id),
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('pending', 'active', 'superseded', 'aborted', 'cleanup_ready')),
  base_revision_id TEXT REFERENCES share_revisions(id),
  content_version_id TEXT NOT NULL REFERENCES content_versions(id),
  access_policy_id TEXT NOT NULL REFERENCES access_policies(id),
  expires_at INTEGER CHECK (expires_at IS NULL OR expires_at >= 0),
  ttl_mode TEXT NOT NULL CHECK (ttl_mode IN ('omit', 'set', 'clear')),
  ttl_seconds INTEGER CHECK (ttl_seconds IS NULL OR ttl_seconds >= 0),
  started_at INTEGER NOT NULL CHECK (started_at >= 0),
  cleanup_at INTEGER NOT NULL CHECK (cleanup_at >= 0),
  commit_status INTEGER CHECK (commit_status IS NULL OR commit_status IN (200, 201)),
  commit_body TEXT,
  activated_at INTEGER CHECK (activated_at IS NULL OR activated_at >= 0)
);

CREATE TABLE content_files (
  content_version_id TEXT NOT NULL REFERENCES content_versions(id),
  path TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  size INTEGER NOT NULL CHECK (size >= 0),
  media_type TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  uploaded INTEGER NOT NULL CHECK (uploaded IN (0, 1)),
  PRIMARY KEY (content_version_id, path),
  UNIQUE (content_version_id, ordinal)
);

CREATE TABLE access_credentials (
  access_policy_id TEXT NOT NULL REFERENCES access_policies(id),
  principal TEXT NOT NULL,
  algorithm TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  iterations INTEGER NOT NULL CHECK (iterations >= 1),
  salt BLOB NOT NULL,
  digest BLOB NOT NULL,
  PRIMARY KEY (access_policy_id, principal)
);

CREATE INDEX shares_list ON shares (created_at DESC, id DESC);
CREATE INDEX shares_project_list ON shares (project, created_at DESC, id DESC);
CREATE INDEX shares_cleanup ON shares (lifecycle, cleanup_after);
CREATE INDEX revisions_cleanup ON share_revisions (lifecycle, cleanup_at);
CREATE INDEX revisions_share ON share_revisions (share_id, lifecycle);
CREATE INDEX revisions_content ON share_revisions (content_version_id);
CREATE INDEX revisions_access ON share_revisions (access_policy_id);
