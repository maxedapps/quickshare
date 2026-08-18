import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

async function tableNames(): Promise<ReadonlyArray<string>> {
  const result = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  ).all<{
    name: string;
  }>();
  return result.results.map((row) => row.name);
}

async function indexNames(): Promise<ReadonlyArray<string>> {
  const result = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name",
  ).all<{
    name: string;
  }>();
  return result.results.map((row) => row.name);
}

async function columns(table: string): Promise<ReadonlyArray<string>> {
  const result = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return result.results.map((row) => row.name);
}

describe("d1 schema", () => {
  it("creates the six application tables and required indexes", async () => {
    expect(await tableNames()).toEqual(
      expect.arrayContaining([
        "access_credentials",
        "access_policies",
        "content_files",
        "content_versions",
        "share_revisions",
        "shares",
      ]),
    );
    expect(await indexNames()).toEqual(
      expect.arrayContaining([
        "shares_list",
        "shares_project_list",
        "shares_cleanup",
        "revisions_cleanup",
        "revisions_share",
        "revisions_content",
        "revisions_access",
      ]),
    );
  });

  it("does not persist visitor urls or start-request replay columns", async () => {
    const shareCols = await columns("shares");
    const revisionCols = await columns("share_revisions");
    expect(shareCols).not.toContain("url");
    expect(shareCols).not.toContain("public_url");
    expect(revisionCols).not.toContain("idempotency_key");
    expect(revisionCols).not.toContain("replay_key");
    expect(revisionCols).not.toContain("fingerprint");
    expect(revisionCols).toContain("ttl_mode");
    expect(revisionCols).toContain("commit_body");
    expect(revisionCols).toContain("cleanup_at");
  });

  it("enforces id length and lifecycle checks", async () => {
    await expect(
      env.DB.prepare("INSERT INTO shares (id, project, created_at, lifecycle) VALUES (?, ?, ?, ?)")
        .bind("short", "default", 1, "draft")
        .run(),
    ).rejects.toThrow();

    await expect(
      env.DB.prepare("INSERT INTO shares (id, project, created_at, lifecycle) VALUES (?, ?, ?, ?)")
        .bind("A".repeat(22), "default", 1, "nope")
        .run(),
    ).rejects.toThrow();
  });

  it("rolls back a failed D1 batch", async () => {
    const id = "B".repeat(22);
    await expect(
      env.DB.batch([
        env.DB.prepare(
          "INSERT INTO shares (id, project, created_at, lifecycle) VALUES (?, ?, ?, ?)",
        ).bind(id, "default", 1, "draft"),
        env.DB.prepare(
          "INSERT INTO shares (id, project, created_at, lifecycle) VALUES (?, ?, ?, ?)",
        ).bind("short", "default", 1, "draft"),
      ]),
    ).rejects.toThrow();
    const row = await env.DB.prepare("SELECT id FROM shares WHERE id = ?").bind(id).first();
    expect(row).toBeNull();
  });
});
