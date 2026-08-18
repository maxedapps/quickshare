import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("d1 migrations", () => {
  it("is idempotent when applied a second time", async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM d1_migrations").first<{
      n: number;
    }>();
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM d1_migrations").first<{
      n: number;
    }>();
    expect(after?.n).toBe(before?.n);
    expect(after?.n).toBeGreaterThan(0);
  });
});
