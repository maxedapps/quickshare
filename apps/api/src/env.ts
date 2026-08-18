export interface RateLimiter {
  readonly take: (key: string) => Promise<boolean>;
}

export interface ApiEnv {
  readonly db: D1Database;
  readonly files: R2Bucket;
  readonly apiKey: string;
  readonly contentBaseUrl: string;
  readonly contentDomain: string;
  readonly now: () => number;
  readonly randomBytes: (size: number) => Uint8Array;
  readonly publishLimit: RateLimiter;
}
