# Quickshare

Self-hosted publishing of static files, static sites, and Markdown onto the operator's own Cloudflare account.

There is no operator dashboard. After Alchemy deploys the stack, the interfaces are an HTTP API, a CLI that talks to that API, an MCP server on the same API, and a visitor Content Worker.

The operator is responsible for what they host. Shares grouped in one project share a browser origin on a custom content domain. The `workers.dev` path fallback does not isolate projects. Arbitrary HTML, JS, and raw Markdown HTML execute as operator-published content.

See [PROJECT.md](./PROJECT.md) for goals and boundaries.

## Prerequisites

- Node 24 and pnpm 11.22.0
- A Cloudflare account with permission to create Workers, D1, R2, and (optionally) DNS routes
- Cloudflare credentials via `alchemy login` or `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN`

```sh
pnpm install --frozen-lockfile
cp .env.example .env
```

## Local development

```sh
pnpm dev
```

This runs Alchemy with local state at stage `local`. The script supplies an inert account ID and invalid token because Alchemy beta.72 validates provider environment variables even for local resources.

## Deploy

Cloud plan/deploy requires explicit operator intent, valid credentials, and a reviewed stage:

```sh
env -u QUICKSHARE_CONTENT_DOMAIN pnpm exec alchemy plan --stage preview
pnpm exec alchemy deploy --stage preview
```

Optional project hostnames require an existing zone whose first-level wildcard hostnames you control:

```sh
: "${QUICKSHARE_PREVIEW_CONTENT_DOMAIN:?set an existing Cloudflare-zone hostname}"
QUICKSHARE_CONTENT_DOMAIN="$QUICKSHARE_PREVIEW_CONTENT_DOMAIN" pnpm exec alchemy plan --stage preview
```

`alchemy deploy` prints the API URL and the current bootstrap API key. Keep that key secret. The cookie-signing key is never printed.

Production D1 and R2 are retained on stack removal. Destroying a preview or production stack does not delete stored files or metadata.

Universal SSL normally covers the zone apex plus first-level subdomains. Use a dedicated domain/zone so `*.<content-domain>` does not capture unrelated hostnames.

## CLI

```sh
pnpm exec quickshare --help
quickshare config --url https://quickshare-api.example.workers.dev --key <apiKey>
quickshare index.html --password this-is-shared
quickshare site/ --project demos --emails a@example.com --passwords testing1
quickshare notes.md --project notes --ttl 24h
quickshare update <id> site/ --ttl 1h
quickshare update <id> --ttl none
quickshare update <id> --public
quickshare list --json
quickshare inspect <id>
quickshare revoke <id>
```

`--password-stdin` and `--passwords-stdin` keep secrets out of shell history. Config is written to `$QUICKSHARE_CONFIG` or `$XDG_CONFIG_HOME/quickshare/config.toml` (mode `0600`).

Every complete publish needs a root `index.html`. Directory uploads include regular files and dotfiles and reject symlinks.

## MCP

`POST /mcp` on the API Worker uses protocol `2026-07-28` and the same bearer key. There is no OAuth discovery. Clients must pin the modern protocol. Tools: `share`, `list`, `inspect`, `revoke`. Files are inline (`utf8` or `base64`); there is no client filesystem or Markdown rendering.

## Access and lifetime

- Email allowlists are a claim plus password, not mailbox proof. At most 10 emails.
- Passwords are stored as PBKDF2-HMAC-SHA-256 hashes only.
- TTL denial is immediate. An expired share can be revived only with an explicit new TTL or `--ttl none` before `expires_at + 24h`.
- Revoke is terminal.
- Start is not idempotent. Retry file PUT and commit by revision ID. Abandoned pending revisions are cleaned after 24 hours.

## Commands

| Command          | Purpose                                             |
| ---------------- | --------------------------------------------------- |
| `pnpm dev`       | Start the local Alchemy environment.                |
| `pnpm typecheck` | Check TypeScript with TS7 / TSGO.                   |
| `pnpm lint`      | Run type-aware Oxlint, Effect, and anti-slop rules. |
| `pnpm format`    | Format supported files with Oxfmt.                  |
| `pnpm test`      | Run Vitest (Node + Worker projects).                |
| `pnpm check`     | Run typecheck, format, lint, and tests.             |
