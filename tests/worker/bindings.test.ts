import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("worker bindings", () => {
  it("runs D1, R2, and migrations in the isolated worker runtime", async () => {
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'shares'",
    ).all<{ name: string }>();
    expect(tables.results.map((row) => row.name)).toContain("shares");

    await env.FILES.put("probe.txt", "hello");
    const object = await env.FILES.get("probe.txt");
    expect(object).not.toBeNull();
    expect(await object?.text()).toBe("hello");
    await env.FILES.delete("probe.txt");
    expect(await env.FILES.get("probe.txt")).toBeNull();
  });
});
