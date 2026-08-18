import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(root, "infra/db/migrations"));
      return {
        main: path.join(root, "tests/worker/test-worker.ts"),
        miniflare: {
          compatibilityDate: "2026-01-01",
          d1Databases: { DB: "quickshare-test-db" },
          r2Buckets: { FILES: "quickshare-test-files" },
          bindings: {
            TEST_MIGRATIONS: migrations,
            API_KEY: "test-api-key",
            COOKIE_SIGNING_KEY: "test-cookie-signing-key-32b!!",
            CONTENT_BASE_URL: "https://content.test.workers.dev",
            CONTENT_DOMAIN: "",
          },
        },
      };
    }),
  ],
  test: {
    name: "worker",
    include: [
      "tests/worker/**/*.test.ts",
      "infra/db/**/*.test.ts",
      "apps/api/src/**/*.test.ts",
      "apps/web/src/**/*.test.ts",
    ],
    setupFiles: [path.join(root, "tests/worker/setup.ts")],
  },
});
