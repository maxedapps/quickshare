import { canonicalizePath, contentObjectKey, Limits } from "@quickshare/contracts";

import { hashPassword } from "../../api/src/access.ts";
import { isLoginPath, parseContentRequest } from "./routing.ts";
import {
  cookieExpiry,
  readCookie,
  setCookieHeader,
  signSession,
  verifySession,
} from "./session.ts";

export interface ContentEnv {
  readonly db: D1Database;
  readonly files: R2Bucket;
  readonly cookieSecret: string;
  readonly contentDomain: string;
  readonly now: () => number;
  readonly loginLimit: { readonly take: (key: string) => Promise<boolean> };
}

const PublicCache = "public, max-age=0, must-revalidate";
const PrivateCache = "private, no-store";
const Same404 = new Response("Not found", {
  status: 404,
  headers: { "cache-control": PrivateCache, "x-content-type-options": "nosniff" },
});

export async function handleContent(request: Request, env: ContentEnv): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return Response.json({ ok: true });
  }
  if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { allow: "GET, HEAD, POST" },
    });
  }
  const route = parseContentRequest(url.host, url.pathname, env.contentDomain);
  if (route === undefined) return Same404;

  const share = await env.db
    .prepare("SELECT * FROM shares WHERE id = ?")
    .bind(route.shareId)
    .first<{
      id: string;
      project: string;
      current_revision_id: string | null;
      lifecycle: string;
      expires_at: number | null;
    }>();
  if (
    share === null ||
    share.project !== route.project ||
    share.current_revision_id === null ||
    share.lifecycle === "revoked" ||
    (share.expires_at !== null && share.expires_at <= env.now())
  ) {
    return Same404;
  }
  const revision = await env.db
    .prepare("SELECT access_policy_id, content_version_id FROM share_revisions WHERE id = ?")
    .bind(share.current_revision_id)
    .first<{ access_policy_id: string; content_version_id: string }>();
  if (revision === null) return Same404;
  const access = await env.db
    .prepare("SELECT kind FROM access_policies WHERE id = ?")
    .bind(revision.access_policy_id)
    .first<{ kind: string }>();
  if (access === null) return Same404;

  if (isLoginPath(route.assetPath)) {
    if (request.method !== "POST") return Same404;
    return handleLogin(
      request,
      env,
      route.shareId,
      route.shareRoot,
      revision.access_policy_id,
      share.expires_at,
      access.kind,
    );
  }
  if (request.method === "POST") {
    return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }

  if (access.kind !== "public") {
    const cookie = readCookie(request.headers.get("Cookie"), share.id);
    const ok =
      cookie !== undefined &&
      (await verifySession(
        cookie,
        env.cookieSecret,
        share.id,
        revision.access_policy_id,
        env.now(),
      ));
    if (!ok) return loginForm(access.kind, route.shareRoot);
  }

  if (!route.wantsIndex && !route.assetPath.includes(".")) {
    const exact = await fileRow(env.db, revision.content_version_id, route.assetPath);
    if (exact === null) {
      const nested = await fileRow(
        env.db,
        revision.content_version_id,
        `${route.assetPath}/index.html`,
      );
      if (nested !== null) {
        return new Response(null, { status: 308, headers: { location: `${url.pathname}/` } });
      }
    }
  }

  const file = await fileRow(env.db, revision.content_version_id, route.assetPath);
  if (file === null) return Same404;
  const object = await env.files.get(
    contentObjectKey(share.id, revision.content_version_id, file.path),
  );
  if (object === null) return Same404;

  const headers = new Headers({
    "content-type": file.media_type,
    "content-length": String(file.size),
    etag: object.httpEtag,
    "x-content-type-options": "nosniff",
    "cache-control": access.kind === "public" ? PublicCache : PrivateCache,
  });
  const inm = request.headers.get("If-None-Match");
  if (inm !== null && inm === object.httpEtag) {
    return new Response(null, { status: 304, headers });
  }
  if (request.method === "HEAD") return new Response(null, { status: 200, headers });
  return new Response(object.body, { status: 200, headers });
}

async function handleLogin(
  request: Request,
  env: ContentEnv,
  shareId: string,
  shareRoot: string,
  accessPolicyId: string,
  expiresAt: number | null,
  kind: string,
): Promise<Response> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const allowed = await env.loginLimit.take(`${shareId}:${ip}`);
  if (!allowed) {
    return html(429, "Too many attempts", true, { "retry-after": "60" });
  }
  const type = request.headers.get("Content-Type") ?? "";
  if (!type.startsWith("application/x-www-form-urlencoded")) {
    return loginForm(kind, shareRoot);
  }
  const text = await request.text();
  if (text.length > 8192) return loginForm(kind, shareRoot);
  const params = new URLSearchParams(text);
  const email = (params.get("email") ?? "").trim().toLowerCase();
  const password = params.get("password") ?? "";
  const next = params.get("next") ?? shareRoot;
  if (!isSafeReturn(next, shareRoot)) return loginForm(kind, shareRoot);

  const ok = await checkCredentials(env.db, accessPolicyId, kind, email, password);
  if (!ok) return loginForm(kind, shareRoot);
  const exp = cookieExpiry(env.now(), expiresAt);
  const token = await signSession({ v: 1, shareId, accessPolicyId, exp }, env.cookieSecret);
  return new Response(null, {
    status: 303,
    headers: {
      location: next,
      "set-cookie": setCookieHeader(shareId, token, shareRoot, exp),
      "cache-control": PrivateCache,
    },
  });
}

async function checkCredentials(
  db: D1Database,
  accessPolicyId: string,
  kind: string,
  email: string,
  password: string,
): Promise<boolean> {
  if ((kind === "email_shared" || kind === "per_email") && email.length === 0) return false;
  if (kind === "email_shared") {
    const listed = await db
      .prepare(
        "SELECT 1 AS ok FROM access_credentials WHERE access_policy_id = ? AND principal = ?",
      )
      .bind(accessPolicyId, email)
      .first();
    if (listed === null) {
      await hashPassword(password, crypto.getRandomValues(new Uint8Array(16)));
      return false;
    }
  }
  const principal = kind === "per_email" ? email : Limits.sharedPrincipal;
  const row = await db
    .prepare(
      "SELECT salt, digest, iterations FROM access_credentials WHERE access_policy_id = ? AND principal = ?",
    )
    .bind(accessPolicyId, principal)
    .first<{ salt: ArrayBuffer; digest: ArrayBuffer; iterations: number }>();
  if (row === null) {
    await hashPassword(password, crypto.getRandomValues(new Uint8Array(16)));
    return false;
  }
  const digest = await hashPassword(password, new Uint8Array(row.salt));
  return equal(digest, new Uint8Array(row.digest));
}

function loginForm(kind: string, shareRoot: string): Response {
  const emailField =
    kind === "email_shared" || kind === "per_email"
      ? `<label>Email <input type="email" name="email" autocomplete="username" required></label>`
      : "";
  const action = `${shareRoot}.quickshare/login`;
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Protected share</title>
<style>body{font-family:system-ui,sans-serif;margin:2rem auto;max-width:24rem}label{display:block;margin:.75rem 0}</style>
</head><body><h1>This share is protected</h1><form method="post" action="${action}">
${emailField}
<label>Password <input type="password" name="password" autocomplete="current-password" required></label>
<button type="submit">Continue</button>
</form></body></html>`;
  return html(401, body, false);
}

function html(status: number, body: string, generic: boolean, extra?: HeadersInit): Response {
  void generic;
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": PrivateCache,
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      ...extra,
    },
  });
}

export function isSafeReturn(target: string, shareRoot: string): boolean {
  if (target.startsWith("https:") || target.startsWith("http:") || target.startsWith("//")) {
    return false;
  }
  if (target.includes("\\") || /[\u0000-\u001f]/.test(target)) return false;
  if (
    target.includes("%2f") ||
    target.includes("%2F") ||
    target.includes("%5c") ||
    target.includes("%5C")
  ) {
    return false;
  }
  if (target === shareRoot) return true;
  if (!target.startsWith(shareRoot)) return false;
  const rest = target.slice(shareRoot.length);
  const segments = rest.split("/");
  const decoded: string[] = [];
  for (const segment of segments) {
    if (segment.length === 0) continue;
    let value: string;
    try {
      value = decodeURIComponent(segment);
    } catch {
      return false;
    }
    if (value.includes("/") || value.includes("\\") || value === "." || value === "..") {
      return false;
    }
    decoded.push(value);
  }
  if (decoded.length === 0) return true;
  return canonicalizePath(decoded.join("/")).ok;
}

async function fileRow(db: D1Database, contentVersionId: string, path: string) {
  return db
    .prepare(
      "SELECT path, size, media_type FROM content_files WHERE content_version_id = ? AND path = ?",
    )
    .bind(contentVersionId, path)
    .first<{ path: string; size: number; media_type: string }>();
}

function equal(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < left.byteLength; i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}
