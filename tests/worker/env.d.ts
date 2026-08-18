import type { D1Migration } from "@cloudflare/vitest-pool-workers";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    DB: D1Database;
    FILES: R2Bucket;
    TEST_MIGRATIONS: D1Migration[];
    API_KEY: string;
    COOKIE_SIGNING_KEY: string;
    CONTENT_BASE_URL: string;
    CONTENT_DOMAIN: string;
  }
}
