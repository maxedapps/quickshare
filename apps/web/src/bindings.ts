import type { ContentEnv } from "./serve.ts";
import { handleContent } from "./serve.ts";

export interface ContentWorkerEnv {
  readonly DB: D1Database;
  readonly FILES: R2Bucket;
  readonly COOKIE_SIGNING_KEY: string;
  readonly CONTENT_DOMAIN: string;
  readonly LOGIN_RATE_LIMIT?: {
    limit: (options: { key: string }) => Promise<{ success: boolean }>;
  };
}

export function toContentEnv(env: ContentWorkerEnv, now = () => Date.now()): ContentEnv {
  return {
    db: env.DB,
    files: env.FILES,
    cookieSecret: env.COOKIE_SIGNING_KEY,
    contentDomain: env.CONTENT_DOMAIN,
    now,
    loginLimit: {
      take: async (key) => {
        if (env.LOGIN_RATE_LIMIT === undefined) return true;
        try {
          return (await env.LOGIN_RATE_LIMIT.limit({ key })).success;
        } catch {
          return false;
        }
      },
    },
  };
}

export default {
  async fetch(request: Request, env: ContentWorkerEnv): Promise<Response> {
    return handleContent(request, toContentEnv(env));
  },
};
