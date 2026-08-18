import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import Api from "./apps/api/src/worker.ts";
import Web from "./apps/web/src/worker.ts";
import { ApiKey, Database, Files } from "./infra/resources.ts";

const providers = Layer.mergeAll(Cloudflare.providers(), Alchemy.RandomProvider());

const resources = Effect.gen(function* () {
  const api = yield* Api;
  const web = yield* Web;
  const database = yield* Database;
  const files = yield* Files;
  yield* ApiKey;

  return {
    apiUrl: api.url,
    contentUrl: web.url,
    databaseName: database.databaseName,
    bucketName: files.bucketName,
  };
});

const useLocalState = Effect.runSync(
  Config.boolean("QUICKSHARE_LOCAL_DEV_STATE").pipe(Config.withDefault(false)),
);
const state = useLocalState ? Alchemy.localState() : Cloudflare.state();

export default Alchemy.Stack("Quickshare", { providers, state }, resources);
