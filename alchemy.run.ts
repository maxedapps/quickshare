import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import {
  ApiKey,
  CookieSigningKey,
  Database,
  Files,
  LoginRateLimit,
  PublishRateLimit,
} from "./infra/resources.ts";

const providers = Layer.mergeAll(Cloudflare.providers(), Alchemy.RandomProvider());

const resources = Effect.gen(function* () {
  const database = yield* Database;
  const files = yield* Files;
  const apiKey = yield* ApiKey;
  const cookieKey = yield* CookieSigningKey;
  const contentDomain = yield* Config.string("QUICKSHARE_CONTENT_DOMAIN").pipe(
    Config.map((value) => value.trim().toLowerCase()),
    Config.option,
  );
  const domain = Option.getOrElse(contentDomain, () => "");

  const web = yield* Cloudflare.Worker("Content", {
    main: "./apps/web/src/worker.ts",
    observability: { enabled: true },
    workersDev: true,
    ...(domain.length > 0 ? { routes: [{ pattern: `*.${domain}/*` }] } : {}),
    env: {
      DB: database,
      FILES: files,
      COOKIE_SIGNING_KEY: cookieKey.text,
      CONTENT_DOMAIN: domain,
      LOGIN_RATE_LIMIT: LoginRateLimit,
    },
  });

  if (domain.length > 0) {
    yield* Cloudflare.DNS.Record("ContentWildcardDns", {
      zoneId: Output.map(web.routes, (routes) => {
        const route = routes[0];
        if (route === undefined) {
          throw new Error("Content worker route did not resolve a zone");
        }
        return route.zoneId;
      }),
      name: `*.${domain}`,
      type: "AAAA",
      content: "100::",
      proxied: true,
      ttl: "1",
      comment: "Quickshare project wildcard",
    });
  }

  const api = yield* Cloudflare.Worker("Api", {
    main: "./apps/api/src/worker.ts",
    observability: { enabled: true },
    crons: ["0 * * * *"],
    env: {
      DB: database,
      FILES: files,
      API_KEY: apiKey.text,
      // SAFETY: Worker.url is a plan-time Output that resolves to the workers.dev URL string.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      CONTENT_BASE_URL: web.url as never,
      CONTENT_DOMAIN: domain,
      PUBLISH_RATE_LIMIT: PublishRateLimit,
    },
  });

  return {
    apiUrl: api.url,
    contentUrl: web.url,
    contentDomain: domain.length > 0 ? domain : null,
    databaseName: database.databaseName,
    bucketName: files.bucketName,
    apiKey: Output.map(apiKey.text, (secret) => Redacted.value(secret)),
  };
});

const useLocalState = Effect.runSync(
  Config.boolean("QUICKSHARE_LOCAL_DEV_STATE").pipe(Config.withDefault(false)),
);
const state = useLocalState ? Alchemy.localState() : Cloudflare.state();

export default Alchemy.Stack("Quickshare", { providers, state }, resources);
