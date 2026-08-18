import type { ApiEnv } from "./env.ts";
import { runCleanup } from "./cleanup.ts";
import { handleApi } from "./http.ts";

export interface ApiWorkerEnv {
  readonly DB: D1Database;
  readonly FILES: R2Bucket;
  readonly API_KEY: string;
  readonly CONTENT_BASE_URL: string;
  readonly CONTENT_DOMAIN: string;
  readonly PUBLISH_RATE_LIMIT?: {
    limit: (options: { key: string }) => Promise<{ success: boolean }>;
  };
}

export function toApiEnv(env: ApiWorkerEnv, now = () => Date.now()): ApiEnv {
  return {
    db: env.DB,
    files: env.FILES,
    apiKey: env.API_KEY,
    contentBaseUrl: env.CONTENT_BASE_URL,
    contentDomain: env.CONTENT_DOMAIN,
    now,
    randomBytes: (size) => crypto.getRandomValues(new Uint8Array(size)),
    publishLimit: {
      take: async (key) => {
        if (env.PUBLISH_RATE_LIMIT === undefined) return true;
        try {
          return (await env.PUBLISH_RATE_LIMIT.limit({ key })).success;
        } catch {
          return false;
        }
      },
    },
  };
}

export default {
  async fetch(request: Request, env: ApiWorkerEnv): Promise<Response> {
    return handleApi(request, toApiEnv(env));
  },
  async scheduled(_controller: ScheduledController, env: ApiWorkerEnv): Promise<void> {
    await runCleanup(toApiEnv(env));
  },
};
