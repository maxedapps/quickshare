import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "node",
    environment: "node",
    include: [
      "packages/**/*.test.ts",
      "apps/cli/src/**/*.test.ts",
      "apps/mcp/src/**/*.test.ts",
      "infra/resources.test.ts",
      "infra/routing.test.ts",
      "tests/acceptance/**/*.test.ts",
    ],
  },
});
