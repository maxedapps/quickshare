import {
  CreateShareRequest,
  decodeListCursor,
  Id,
  Limits,
  parseIfMatch,
  ProblemCodes,
  ProblemContentType,
  problem,
  ProjectSlug,
  quotedEtag,
  Routes,
  ShareDetail,
  ShareListResponse,
  StartResponse,
  UpdateShareRequest,
} from "@quickshare/contracts";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import type { ApiEnv } from "./env.ts";
import {
  abort,
  ApiError,
  commit,
  inspect,
  listShares,
  putFile,
  revoke,
  startCreate,
  startUpdate,
} from "./share.ts";

const JsonTypes = new Set(["application/json", "application/json; charset=utf-8"]);

export async function handleApi(request: Request, env: ApiEnv): Promise<Response> {
  const url = new URL(request.url);
  const requestId = request.headers.get("CF-Ray") ?? generateRequestId(env);
  try {
    if (request.method === "GET" && url.pathname === Routes.health) {
      return Response.json({ ok: true });
    }
    if (url.pathname === Routes.mcp || url.pathname.startsWith("/v1/")) {
      const auth = authorize(request, env.apiKey);
      if (auth !== undefined)
        return problemResponse(auth, requestId, {
          "WWW-Authenticate": 'Bearer realm="quickshare"',
        });
    }
    if (url.pathname === Routes.mcp) {
      if (request.method !== "POST") return methodNotAllowed(request.method, "POST", requestId);
      const origin = request.headers.get("Origin");
      if (origin !== null) throw new ApiError(403, ProblemCodes.forbidden, "Origin not allowed");
      const length = request.headers.get("Content-Length");
      if (length !== null && Number(length) > Limits.mcpMaxBodyBytes) {
        throw new ApiError(413, ProblemCodes.payload_too_large, "Payload too large");
      }
      const { handleMcp } = await import("./mcp-http.ts");
      return handleMcp(request, env, requestId);
    }

    const created = match(url.pathname, "/v1/shares");
    if (created && request.method === "POST") {
      await rateLimit(request, env, requestId);
      const body = await readCreate(request);
      return json(await startCreate(env, body), 202, requestId);
    }
    if (created && request.method === "GET") {
      const projectRaw = url.searchParams.get("project");
      const project =
        projectRaw === null ? undefined : Schema.decodeUnknownSync(ProjectSlug)(projectRaw);
      const limitRaw = url.searchParams.get("limit");
      const limit = limitRaw === null ? Limits.listDefaultLimit : Number(limitRaw);
      if (!Number.isInteger(limit) || limit < 1 || limit > Limits.listMaxLimit) {
        throw new ApiError(400, ProblemCodes.validation, "Invalid limit");
      }
      const cursorRaw = url.searchParams.get("cursor");
      const cursor = cursorRaw === null ? undefined : decodeListCursor(cursorRaw);
      if (cursorRaw !== null && cursor === undefined) {
        throw new ApiError(400, ProblemCodes.invalid_cursor, "Invalid cursor");
      }
      return json(await listShares(env, project, limit, cursor), 200, requestId);
    }
    if (created) return methodNotAllowed(request.method, "GET, POST", requestId);

    const share = matchParam(url.pathname, "/v1/shares/");
    if (share !== undefined && !share.includes("/")) {
      Schema.decodeUnknownSync(Id)(share);
      if (request.method === "GET") return json(await inspect(env, share), 200, requestId);
      if (request.method === "DELETE") {
        await revoke(env, share);
        return new Response(null, { status: 204, headers: baseHeaders(requestId) });
      }
      return methodNotAllowed(request.method, "GET, DELETE", requestId);
    }

    const revisionStart = matchSuffix(url.pathname, "/v1/shares/", "/revisions");
    if (revisionStart !== undefined) {
      if (request.method !== "POST") return methodNotAllowed(request.method, "POST", requestId);
      Schema.decodeUnknownSync(Id)(revisionStart);
      await rateLimit(request, env, requestId);
      const body = await readUpdate(request);
      return json(
        await startUpdate(
          env,
          revisionStart,
          parseIfMatch(request.headers.get("If-Match") ?? ""),
          body,
        ),
        202,
        requestId,
      );
    }

    const upload = matchUpload(url.pathname);
    if (upload !== undefined) {
      if (request.method !== "PUT") return methodNotAllowed(request.method, "PUT", requestId);
      await putFile(env, upload.revisionId, upload.ordinal, request);
      return new Response(null, { status: 204, headers: baseHeaders(requestId) });
    }

    const commitMatch = matchSuffix(url.pathname, "/v1/uploads/", "/commit");
    if (commitMatch !== undefined) {
      if (request.method !== "POST") return methodNotAllowed(request.method, "POST", requestId);
      const result = await commit(env, commitMatch);
      return json(result.body, result.status, requestId, {
        ETag: quotedEtag(result.body.revisionId),
      });
    }

    const abortMatch = matchPrefix(url.pathname, "/v1/uploads/");
    if (abortMatch !== undefined && !abortMatch.includes("/")) {
      if (request.method !== "DELETE") return methodNotAllowed(request.method, "DELETE", requestId);
      await abort(env, abortMatch);
      return new Response(null, { status: 204, headers: baseHeaders(requestId) });
    }

    return problemResponse(new ApiError(404, ProblemCodes.not_found, "Not found"), requestId);
  } catch (cause) {
    if (cause instanceof ApiError) return problemResponse(cause, requestId);
    if (cause instanceof Schema.SchemaError) {
      return problemResponse(
        new ApiError(400, ProblemCodes.validation, "Validation failed"),
        requestId,
      );
    }
    return problemResponse(new ApiError(500, ProblemCodes.internal, "Internal error"), requestId);
  }
}

export function authorize(request: Request, apiKey: string): ApiError | undefined {
  const header = request.headers.get("Authorization");
  if (header === null) return new ApiError(401, ProblemCodes.unauthorized, "Unauthorized");
  const bearer = /^Bearer (\S+)$/.exec(header);
  if (bearer === null || request.headers.get("Authorization")?.includes(",")) {
    return new ApiError(401, ProblemCodes.unauthorized, "Unauthorized");
  }
  const provided = new TextEncoder().encode(bearer[1] ?? "");
  const expected = new TextEncoder().encode(apiKey);
  if (provided.byteLength !== expected.byteLength) {
    return new ApiError(401, ProblemCodes.unauthorized, "Unauthorized");
  }
  let diff = 0;
  for (let i = 0; i < expected.byteLength; i++) diff |= (provided[i] ?? 0) ^ (expected[i] ?? 0);
  if (diff !== 0) return new ApiError(401, ProblemCodes.unauthorized, "Unauthorized");
  return undefined;
}

async function readCreate(request: Request): Promise<typeof CreateShareRequest.Type> {
  return decodeBody(request, CreateShareRequest, Limits.maxManifestBytes);
}

async function readUpdate(request: Request): Promise<typeof UpdateShareRequest.Type> {
  return decodeBody(request, UpdateShareRequest, Limits.maxManifestBytes);
}

async function decodeBody<A>(
  request: Request,
  schema: Schema.Codec<A>,
  maxBytes: number,
): Promise<A> {
  const type = (request.headers.get("Content-Type") ?? "").toLowerCase();
  if (!JsonTypes.has(type) && !type.startsWith("application/json")) {
    throw new ApiError(415, ProblemCodes.unsupported_media_type, "Unsupported Media Type");
  }
  const length = request.headers.get("Content-Length");
  if (length !== null && Number(length) > maxBytes) {
    throw new ApiError(413, ProblemCodes.payload_too_large, "Payload too large");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new ApiError(413, ProblemCodes.payload_too_large, "Payload too large");
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError(400, ProblemCodes.validation, "Invalid JSON");
  }
  const decoded = Schema.decodeUnknownResult(schema)(parsed);
  if (Result.isFailure(decoded)) {
    throw new ApiError(400, ProblemCodes.validation, "Validation failed");
  }
  return decoded.success;
}

async function rateLimit(request: Request, env: ApiEnv, requestId: string): Promise<void> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const key = `${await sha256Hex(env.apiKey)}:${ip}`;
  const ok = await env.publishLimit.take(key);
  if (!ok) throw new ApiError(429, ProblemCodes.rate_limited, "Rate limited");
  void requestId;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function json(
  body: ShareListResponse | ShareDetail | StartResponse | { readonly ok: true },
  status: number,
  requestId: string,
  extra?: HeadersInit,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...baseHeaders(requestId),
      ...extra,
    },
  });
}

function problemResponse(error: ApiError, requestId: string, extra?: HeadersInit): Response {
  return new Response(
    JSON.stringify(problem(error.status, error.title, error.code, requestId, error.detail)),
    {
      status: error.status,
      headers: {
        "content-type": ProblemContentType,
        "cache-control": "no-store",
        ...(error.code === ProblemCodes.rate_limited ? { "retry-after": "60" } : {}),
        ...baseHeaders(requestId),
        ...extra,
      },
    },
  );
}

function methodNotAllowed(method: string, allow: string, requestId: string): Response {
  void method;
  return new Response(
    JSON.stringify(problem(405, "Method not allowed", ProblemCodes.method_not_allowed, requestId)),
    {
      status: 405,
      headers: { allow, "content-type": ProblemContentType, ...baseHeaders(requestId) },
    },
  );
}

function baseHeaders(requestId: string): HeadersInit {
  return { "x-request-id": requestId };
}

function generateRequestId(env: ApiEnv): string {
  return [...env.randomBytes(8)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function match(pathname: string, exact: string): boolean {
  return pathname === exact;
}

function matchParam(pathname: string, prefix: string): string | undefined {
  if (!pathname.startsWith(prefix)) return undefined;
  return pathname.slice(prefix.length);
}

function matchPrefix(pathname: string, prefix: string): string | undefined {
  return matchParam(pathname, prefix);
}

function matchSuffix(pathname: string, prefix: string, suffix: string): string | undefined {
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) return undefined;
  return pathname.slice(prefix.length, pathname.length - suffix.length);
}

function matchUpload(
  pathname: string,
): { readonly revisionId: string; readonly ordinal: number } | undefined {
  const upload = /^\/v1\/uploads\/([A-Za-z0-9_-]{22})\/files\/(\d+)$/.exec(pathname);
  if (upload === null || upload[1] === undefined || upload[2] === undefined) return undefined;
  return { revisionId: upload[1], ordinal: Number(upload[2]) };
}
