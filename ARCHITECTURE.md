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
Content Worker ── read D1 + R2
                └── optional password / email gate
```

Alchemy deploys this stack. Creating a share is an API upload, not a new Worker or a new Alchemy apply.

There is no operator dashboard, no product accounts, and no multi-tenant SaaS layer. `apps/web` is the visitor Content Worker, not a product UI.

Workspace apps are `@quickshare/api`, `@quickshare/cli`, `@quickshare/mcp`, and `@quickshare/web`. Shared `packages/*` exist only when two or more apps need the same module. D1 schema will use Drizzle through Alchemy later.

## Ownership

| Path                      | Responsibility                                           |
| ------------------------- | -------------------------------------------------------- |
| `alchemy.run.ts`          | Stack composition root: providers, state, resource graph |
| `infra/resources.ts`      | D1, private R2, bootstrap API key (stack-only for now)   |
| `apps/api`                | API Worker (management HTTP and future `/mcp` mount)     |
| `apps/web`                | Content Worker (public file serving)                     |
| `apps/cli`                | CLI entry (thin HTTP client of the management API)       |
| `apps/mcp`                | MCP server (`@modelcontextprotocol/server` 2.x)          |
| `tools/oxlint/anti-slop/` | Vendored anti-slop plugin and upstream provenance        |
| `oxlint.config.ts`        | Type-aware native, Effect, and anti-slop lint policy     |

Workers currently expose only a `/health` stub. Bindings, publish, visitor access, expiry, and MCP are not wired yet.

## Tooling

TypeScript is 7.0.2 only. `@effect/tsgo` patches its supported TS7, Oxlint, and `oxlint-tsgolint` binaries through the idempotent `prepare` script. Oxlint runs type-aware with the Effect recommended preset, strict correctness/suspicious/performance categories, and every vendored anti-slop rule. The four-version compatibility matrix is documented in `README.md` and must be upgraded together. Oxfmt remains the formatter.

The anti-slop source lives under `tools/oxlint/anti-slop/`; `PROVENANCE.md` records its exact upstream commit. Tool-owned source is excluded from its own lint/format pass.

Effect owns both Alchemy's resource graph and future Worker/CLI programs. Add Effect Services and Layers when real domain dependencies justify them.

`pnpm dev` selects local state explicitly and supplies inert credentials only to satisfy beta.72's local provider validation. Plan/deploy commands do not use those script-local values and use shared `Cloudflare.state()` by default. Production D1 is retained on stack removal.
