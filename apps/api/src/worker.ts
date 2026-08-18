import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

export default Cloudflare.Worker(
  "Api",
  { main: import.meta.url, observability: { enabled: true } },
  Effect.succeed({
    fetch: Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const url = new URL(request.url, "https://worker.invalid");
      if (request.method === "GET" && url.pathname === "/health") {
        return yield* HttpServerResponse.json({ ok: true });
      }
      return HttpServerResponse.text("Not found", { status: 404 });
    }),
  }),
);
