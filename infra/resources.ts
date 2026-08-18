import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

export const RESOURCE_IDS = {
  database: "Database",
  files: "Files",
  api: "Api",
  content: "Content",
  apiKey: "ApiKey",
  cookieSigningKey: "CookieSigningKey",
} as const;

export const Database = Effect.gen(function* () {
  const stack = yield* Alchemy.Stack;
  return yield* Cloudflare.D1.Database(RESOURCE_IDS.database, {
    migrationsDir: "infra/db/migrations",
    migrationsTable: "d1_migrations",
  }).pipe(Alchemy.RemovalPolicy.retain(stack.stage === "prod"));
});

export const Files = Effect.gen(function* () {
  const stack = yield* Alchemy.Stack;
  return yield* Cloudflare.R2.Bucket(RESOURCE_IDS.files).pipe(
    Alchemy.RemovalPolicy.retain(stack.stage === "prod"),
  );
});

export const ApiKey = Alchemy.Random(RESOURCE_IDS.apiKey);
export const CookieSigningKey = Alchemy.Random(RESOURCE_IDS.cookieSigningKey);

export const PublishRateLimit = Cloudflare.RateLimit("PublishRateLimit", {
  namespaceId: 1001,
  simple: { limit: 10, period: 60 },
});

export const LoginRateLimit = Cloudflare.RateLimit("LoginRateLimit", {
  namespaceId: 1002,
  simple: { limit: 10, period: 60 },
});
