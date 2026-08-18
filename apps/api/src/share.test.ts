import { env } from "cloudflare:workers";
import {
  bytesToHex,
  formatContentDigest,
  hexToBytes,
  quotedEtag,
  RootIndexPath,
} from "@quickshare/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import type { ApiEnv } from "./env.ts";
import { handleApi } from "./http.ts";
import { handleContent } from "../../web/src/serve.ts";

function testEnv(now = 1_700_000_000_000): ApiEnv {
  let seq = 0;
  return {
    db: env.DB,
    files: env.FILES,
    apiKey: "test-api-key",
    contentBaseUrl: "https://content.test.workers.dev",
    contentDomain: "",
    now: () => now,
    randomBytes: (size) => {
      seq += 1;
      const bytes = new Uint8Array(size);
      bytes[0] = seq;
      bytes[1] = seq >> 8;
      return bytes;
    },
    publishLimit: { take: async () => true },
  };
}

async function reset() {
  for (const table of [
    "access_credentials",
    "content_files",
    "share_revisions",
    "access_policies",
    "content_versions",
    "shares",
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

async function publish(
  api: ApiEnv,
  html = "<h1>hi</h1>",
  extra: {
    readonly ttlSeconds?: number;
    readonly access?: { readonly kind: "shared_password"; readonly password: string };
  } = {},
) {
  const body = new TextEncoder().encode(html);
  const digest = await sha256(body);
  const start = await handleApi(
    new Request("https://api.test/v1/shares", {
      method: "POST",
      headers: { authorization: "Bearer test-api-key", "content-type": "application/json" },
      body: JSON.stringify({
        files: [
          {
            ordinal: 0,
            path: RootIndexPath,
            size: body.byteLength,
            mediaType: "text/html",
            sha256: digest,
          },
        ],
        ...extra,
      }),
    }),
    api,
  );
  expect(start.status).toBe(202);
  const started = await start.json<{ shareId: string; revisionId: string; url: string }>();
  const put = await handleApi(
    new Request(`https://api.test/v1/uploads/${started.revisionId}/files/0`, {
      method: "PUT",
      headers: {
        authorization: "Bearer test-api-key",
        "content-length": String(body.byteLength),
        "content-digest": formatContentDigest(hexToBytes(digest)),
      },
      body,
    }),
    api,
  );
  expect(put.status).toBe(204);
  const committed = await handleApi(
    new Request(`https://api.test/v1/uploads/${started.revisionId}/commit`, {
      method: "POST",
      headers: { authorization: "Bearer test-api-key" },
    }),
    api,
  );
  expect([200, 201]).toContain(committed.status);
  return { started, committed, html };
}

describe("share lifecycle", () => {
  beforeEach(reset);

  it("requires bearer auth before reading the body", async () => {
    const response = await handleApi(
      new Request("https://api.test/v1/shares", { method: "POST", body: "password=secret" }),
      testEnv(),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
    expect(await response.text()).not.toContain("password");
  });

  it("creates, serves, updates TTL, and revokes a public share", async () => {
    const api = testEnv();
    const { started, committed } = await publish(api);
    expect(committed.status).toBe(201);
    const created = await committed.json<{ id: string; url: string; revisionId: string }>();
    expect(created.url).toBe(started.url);

    const page = await handleContent(new Request(created.url), {
      db: env.DB,
      files: env.FILES,
      cookieSecret: "test-cookie-signing-key-32b!!",
      contentDomain: "",
      now: api.now,
      loginLimit: { take: async () => true },
    });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("hi");

    const update = await handleApi(
      new Request(`https://api.test/v1/shares/${created.id}/revisions`, {
        method: "POST",
        headers: {
          authorization: "Bearer test-api-key",
          "content-type": "application/json",
          "if-match": quotedEtag(created.revisionId),
        },
        body: JSON.stringify({ ttlSeconds: 3600 }),
      }),
      api,
    );
    expect(update.status).toBe(202);
    const startedUpdate = await update.json<{ revisionId: string }>();
    const committedUpdate = await handleApi(
      new Request(`https://api.test/v1/uploads/${startedUpdate.revisionId}/commit`, {
        method: "POST",
        headers: { authorization: "Bearer test-api-key" },
      }),
      api,
    );
    expect(committedUpdate.status).toBe(200);
    const updated = await committedUpdate.json<{ url: string; id: string }>();
    expect(updated.url).toBe(created.url);
    expect(updated.id).toBe(created.id);

    const revoked = await handleApi(
      new Request(`https://api.test/v1/shares/${created.id}`, {
        method: "DELETE",
        headers: { authorization: "Bearer test-api-key" },
      }),
      api,
    );
    expect(revoked.status).toBe(204);
    const missing = await handleContent(new Request(created.url), {
      db: env.DB,
      files: env.FILES,
      cookieSecret: "x",
      contentDomain: "",
      now: api.now,
      loginLimit: { take: async () => true },
    });
    expect(missing.status).toBe(404);
  });

  it("rejects an empty update and a missing If-Match", async () => {
    const api = testEnv();
    const { committed } = await publish(api);
    const created = await committed.json<{ id: string }>();
    const empty = await handleApi(
      new Request(`https://api.test/v1/shares/${created.id}/revisions`, {
        method: "POST",
        headers: {
          authorization: "Bearer test-api-key",
          "content-type": "application/json",
          "if-match": '"AAAAAAAAAAAAAAAAAAAAAA"',
        },
        body: "{}",
      }),
      api,
    );
    expect(empty.status).toBe(400);
    const missing = await handleApi(
      new Request(`https://api.test/v1/shares/${created.id}/revisions`, {
        method: "POST",
        headers: { authorization: "Bearer test-api-key", "content-type": "application/json" },
        body: JSON.stringify({ ttlSeconds: 3600 }),
      }),
      api,
    );
    expect(missing.status).toBe(428);
  });

  it("returns Retry-After on publish 429 and 409s a losing commit race", async () => {
    const limited = testEnv();
    const denied = await handleApi(
      new Request("https://api.test/v1/shares", {
        method: "POST",
        headers: { authorization: "Bearer test-api-key", "content-type": "application/json" },
        body: JSON.stringify({
          files: [
            {
              ordinal: 0,
              path: RootIndexPath,
              size: 1,
              mediaType: "text/html",
              sha256: "a".repeat(64),
            },
          ],
        }),
      }),
      { ...limited, publishLimit: { take: async () => false } },
    );
    expect(denied.status).toBe(429);
    expect(denied.headers.get("retry-after")).toBe("60");

    const api = testEnv();
    const { committed } = await publish(api);
    const created = await committed.json<{ id: string; revisionId: string }>();
    const startA = await handleApi(
      new Request(`https://api.test/v1/shares/${created.id}/revisions`, {
        method: "POST",
        headers: {
          authorization: "Bearer test-api-key",
          "content-type": "application/json",
          "if-match": quotedEtag(created.revisionId),
        },
        body: JSON.stringify({ ttlSeconds: 3600 }),
      }),
      api,
    );
    const startB = await handleApi(
      new Request(`https://api.test/v1/shares/${created.id}/revisions`, {
        method: "POST",
        headers: {
          authorization: "Bearer test-api-key",
          "content-type": "application/json",
          "if-match": quotedEtag(created.revisionId),
        },
        body: JSON.stringify({ ttlSeconds: 7200 }),
      }),
      api,
    );
    const a = await startA.json<{ revisionId: string }>();
    const b = await startB.json<{ revisionId: string }>();
    const first = await handleApi(
      new Request(`https://api.test/v1/uploads/${a.revisionId}/commit`, {
        method: "POST",
        headers: { authorization: "Bearer test-api-key" },
      }),
      api,
    );
    const second = await handleApi(
      new Request(`https://api.test/v1/uploads/${b.revisionId}/commit`, {
        method: "POST",
        headers: { authorization: "Bearer test-api-key" },
      }),
      api,
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    const inspect = await handleApi(
      new Request(`https://api.test/v1/shares/${created.id}`, {
        headers: { authorization: "Bearer test-api-key" },
      }),
      api,
    );
    const detail = await inspect.json<{ revisionId: string }>();
    expect(detail.revisionId).toBe(a.revisionId);
  });

  it("posts the login form to the reserved share login path", async () => {
    const api = testEnv();
    const { committed } = await publish(api, "<h1>secret</h1>", {
      access: { kind: "shared_password", password: "hunter2" },
    });
    const created = await committed.json<{ url: string }>();
    const page = await handleContent(new Request(created.url), {
      db: env.DB,
      files: env.FILES,
      cookieSecret: "test-cookie-signing-key-32b!!",
      contentDomain: "",
      now: api.now,
      loginLimit: { take: async () => true },
    });
    expect(page.status).toBe(401);
    const html = await page.text();
    expect(html).toContain('action="');
    expect(html).toContain(".quickshare/login");
    expect(html).not.toContain('action=""');
  });

  it("does not abort a revision that already won the share pointer", async () => {
    const api = testEnv();
    const { committed } = await publish(api);
    const created = await committed.json<{ id: string; revisionId: string; url: string }>();
    const start = await handleApi(
      new Request(`https://api.test/v1/shares/${created.id}/revisions`, {
        method: "POST",
        headers: {
          authorization: "Bearer test-api-key",
          "content-type": "application/json",
          "if-match": quotedEtag(created.revisionId),
        },
        body: JSON.stringify({ ttlSeconds: 3600 }),
      }),
      api,
    );
    const started = await start.json<{ revisionId: string }>();
    await env.DB.prepare(
      "UPDATE shares SET current_revision_id = ?, lifecycle = 'active', expires_at = ? WHERE id = ?",
    )
      .bind(started.revisionId, api.now() + 3_600_000, created.id)
      .run();
    const aborted = await handleApi(
      new Request(`https://api.test/v1/uploads/${started.revisionId}`, {
        method: "DELETE",
        headers: { authorization: "Bearer test-api-key" },
      }),
      api,
    );
    expect(aborted.status).toBe(204);
    const inspect = await handleApi(
      new Request(`https://api.test/v1/shares/${created.id}`, {
        headers: { authorization: "Bearer test-api-key" },
      }),
      api,
    );
    const detail = await inspect.json<{ revisionId: string }>();
    expect(detail.revisionId).toBe(started.revisionId);
    const page = await handleContent(new Request(created.url), {
      db: env.DB,
      files: env.FILES,
      cookieSecret: "test-cookie-signing-key-32b!!",
      contentDomain: "",
      now: api.now,
      loginLimit: { take: async () => true },
    });
    expect(page.status).toBe(200);
  });
});
