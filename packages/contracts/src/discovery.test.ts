import { readFileSync } from "node:fs";
import { describe, expect, it } from "@effect/vitest";

describe("test discovery", () => {
  it("fails when a required test path is missing because passWithNoTests is off", () => {
    const root = readFileSync(new URL("../../../vitest.config.ts", import.meta.url), "utf8");
    const node = readFileSync(new URL("../../../vitest.node.config.ts", import.meta.url), "utf8");
    const worker = readFileSync(
      new URL("../../../vitest.worker.config.ts", import.meta.url),
      "utf8",
    );
    expect(root).toContain("projects");
    expect(root).not.toContain("passWithNoTests: true");
    expect(node).not.toContain("passWithNoTests");
    expect(worker).not.toContain("passWithNoTests");
    expect(node).toContain("packages/**/*.test.ts");
    expect(worker).toContain("infra/db/**/*.test.ts");
  });
});
