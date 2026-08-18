import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

export const Database = Effect.gen(function* () {
  const stack = yield* Alchemy.Stack;
  return yield* Cloudflare.D1.Database("Database").pipe(
    Alchemy.RemovalPolicy.retain(stack.stage === "prod"),
  );
});

export const Files = Cloudflare.R2.Bucket("Files");

export const ApiKey = Alchemy.Random("ApiKey");
