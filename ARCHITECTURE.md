# Architecture

## Shape

```text
CLI / MCP
    │  Bearer API key
    ▼
API Worker  ── D1 (metadata, hashes, expiry)
    │       └── R2 (private files)
    │
    └── POST /mcp   (MCP 2026-07-28, same key)

Visitor
    ▼
<project>.<content-domain>/<share-id>/
    or /<project>/<share-id>/ on workers.dev
    │
    ▼
Content Worker ── read D1 + R2
                └── optional password / email gate
```

Alchemy deploys this stack from `alchemy.run.ts`. Creating a share is an API upload, not a new Worker or a new Alchemy apply.

There is no operator dashboard, no product accounts, and no multi-tenant SaaS layer. `apps/web` is the visitor Content Worker.

Workspace apps are `@quickshare/api`, `@quickshare/cli`, `@quickshare/mcp`, and `@quickshare/web`. `packages/contracts` holds the shared wire schemas, limits, IDs, paths, and Problem Details.

## Ownership

| Path                      | Responsibility                                           |
| ------------------------- | -------------------------------------------------------- |
| `alchemy.run.ts`          | Stack composition root: providers, state, resource graph |
| `infra/resources.ts`      | D1, private R2, bootstrap secrets, rate-limit bindings   |
| `infra/db/`               | Drizzle schema and D1 SQL migrations                     |
| `packages/contracts`      | Shared IDs, limits, API DTOs, Problem Details            |
| `apps/api`                | Management HTTP, staged upload, cleanup cron, `/mcp`     |
| `apps/web`                | Public/protected file serving and login                  |
| `apps/cli`                | Thin HTTP client of the management API                   |
| `apps/mcp`                | Protocol-only MCP factory over injected operations       |
| `tools/oxlint/anti-slop/` | Vendored anti-slop plugin and upstream provenance        |

## Persistence

D1 tables: `shares`, `share_revisions`, `content_versions`, `content_files`, `access_policies`, `access_credentials`. Visitor URLs are never stored. `shares.current_revision_id` is application-enforced.

R2 keys: `shares/<shareId>/content/<contentVersionId>/<canonicalPath>`.

Activation writes all objects first, then conditionally updates D1. Cron on the API Worker deletes expired (after the 24-hour recovery window), revoked, aborted, and superseded data. Production D1 and R2 are retained on stack removal.

## Access trust

Email allowlisting is a claim plus password, not mailbox proof. Quickshare does not send mail or verify ownership. Policy replacement issues a new access-policy ID and invalidates cookies. Content/TTL-only updates keep the policy ID.

## Tooling

TypeScript is 7.0.2 only. `@effect/tsgo` patches its supported TS7, Oxlint, and `oxlint-tsgolint` binaries through the idempotent `prepare` script.

`pnpm dev` selects local state explicitly and supplies inert credentials only to satisfy beta.72's local provider validation. Plan/deploy commands do not use those script-local values and use shared `Cloudflare.state()` by default.
