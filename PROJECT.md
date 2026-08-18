# Quickshare

Quickshare is a self-hosted tool for publishing static files, static sites, and Markdown (rendered to HTML) onto the operator's own Cloudflare account.

Alchemy provisions the Cloudflare resources once. After that, the only interfaces are an HTTP API, a CLI that talks to that API, and an MCP server on the same API. There is no web UI, no product accounts, and no multi-tenant SaaS layer.

Each installation is one operator's service. Visitors receive a URL. Optional password and email allowlists restrict who can open a share. The operator is responsible for what they host.

## Goals

- Publish a file, a directory, or a Markdown document in one command.
- Optionally protect a share with a shared password, an email allowlist, or per-email passwords.
- Optionally expire shares after a TTL and delete their stored files.
- Keep the deployed surface small: one Alchemy stack, two Workers, one private R2 bucket, one D1 database.
- Protect the management API with a bootstrap API key so a public Worker is not an open publish endpoint.

## Features

### Publishing

The CLI accepts:

- A single HTML (or other static) file, stored as `index.html`.
- A directory of static assets (HTML, CSS, JS, images, and similar).
- A Markdown file (`.md` / `.markdown`), rendered to HTML at publish time in the CLI, then stored as a static page.

Markdown is not rendered on request. The Content Worker only serves files.

Each share gets an unguessable URL. Replacing, listing, inspecting, expiring, and revoking a share go through the same API as create.

### Visitor access

Access is optional and per share:

| Flags | Policy |
| --- | --- |
| none | Anyone with the URL |
| `--password <shared>` | Shared password |
| `--password <shared> --emails a,b` | Listed emails plus that shared password |
| `--emails a,b --passwords p1,p2` | Listed emails with their own passwords |

`--emails` is an allowlist, not an invitation. Quickshare does not send mail.

Protected shares show a small platform login form and set a host-only cookie after a successful check. Passwords are stored as hashes only.

### Lifetime

A share may have a TTL. After expiry, every visitor request is denied. A cron job later deletes the share's R2 objects and metadata. Expiry is the access rule; object deletion is cleanup.

### Management API lock

First deploy mints an API key (`Alchemy.Random`) and prints it once with the API URL. The CLI and MCP send `Authorization: Bearer <key>`. There is no user directory and no OAuth on the service itself.

`quickshare config` only writes that URL and key to a local client file (for example `~/.config/quickshare/config.toml`) so later commands do not need `--url` and `--key`. Environment variables or per-command flags are equivalent.

## Commands

```bash
# Deploy the service once (Alchemy).
alchemy deploy
# prints API URL and API key

# Save local CLI settings (optional).
quickshare config --url https://quickshare-api.example.workers.dev --key <apiKey>

# Publish.
quickshare index.html --password this-is-shared
quickshare index.html --password still-shared --emails test@example.com,test2@example.com
quickshare site/ --emails test@example.com,test2@example.com --passwords testing1,testing2
quickshare notes.md --ttl 24h --password this-is-shared

# Manage.
quickshare list
quickshare inspect <id>
quickshare expire <id> --ttl 1h
quickshare revoke <id>
```

Human-readable output is the default. `--json` is for scripts. `--password-stdin` (or equivalent) should be available so secrets need not appear in shell history.

MCP tools mirror the same operations: share, list, inspect, expire, revoke.

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

Default URLs can live on `workers.dev`. A custom domain is optional.

## Tech stack

### Application

| Area | Choice |
| --- | --- |
| Language | TypeScript 7 |
| Package manager | pnpm 11, Node 24 |
| Runtime logic | Effect v4 |
| Infrastructure | Alchemy v2 (`alchemy.run.ts` is the only composition root) |
| CLI | Thin HTTP client of the management API |
| MCP | `@modelcontextprotocol/server` 2.x, spec `2026-07-28`, mounted on the API Worker |
| Lint / format | Oxlint (type-aware, Effect + anti-slop) and Oxfmt |
| Tests | Vitest with Effect test support |

Toolchain and versions follow `web-project-base`, without SvelteKit, Vite, Better Auth, or Drizzle-for-auth. There is no dual TypeScript 6/7 compiler.

### Cloudflare

| Resource | Role |
| --- | --- |
| API Worker | Management HTTP API and `/mcp` |
| Content Worker | Public file serving and visitor login |
| R2 | Private object store for share files |
| D1 | Share metadata, credential hashes, expiry |
| Cron | Delete expired shares |
| Rate Limit binding | Throttle publish and login attempts |
| `Alchemy.Random` | Bootstrap API key |

No Pages, no public R2 bucket, no Workers for Platforms, no Durable Objects, no Queues, no Workflows, no Better Auth, and no Email Routing in the first version.

## Boundaries

- Not a hosted multi-tenant product.
- No web dashboard.
- No product user accounts or Cloudflare Access as the visitor password gate.
- No outbound invitation email.
- No per-share Worker, Website, or Alchemy deploy.
- The operator is responsible for published content. A README note should say so.

## Operator setup (intent)

1. Clone the repo, install, configure Cloudflare credentials for Alchemy.
2. `alchemy deploy` — creates the Workers, D1, R2, cron, and API key.
3. Point the CLI at the printed URL and key.
4. Publish with `quickshare`.
