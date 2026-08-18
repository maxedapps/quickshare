# Quickshare

Quickshare is a self-hosted tool for publishing static files, static sites, and Markdown (rendered to HTML) onto the operator's own Cloudflare account.

Alchemy provisions the Cloudflare resources once. After that, the only interfaces are an HTTP API, a CLI that talks to that API, and an MCP server on the same API. There is no web UI, no product accounts, and no multi-tenant SaaS layer.

Each installation is one operator's service. Visitors receive a URL. Optional password and email allowlists restrict who can open a share. The operator is responsible for what they host.

## Goals

- Publish a file, a directory, or a Markdown document in one command.
- Group shares under lightweight projects identified only by slugs.
- Optionally protect a share with a shared password, an email allowlist, or per-email passwords.
- Optionally expire shares after a TTL and delete their stored files.
- Keep the CLI, MCP tool set, and deployed surface small.
- Keep the deployed surface to one Alchemy stack, two Workers, one private R2 bucket, and one D1 database, plus optional domain routing.
- Protect the management API with a bootstrap API key so a public Worker is not an open publish endpoint.

## Features

### Projects and URLs

Every share belongs to a project. A project is only a normalized slug stored with its shares; it has no separate lifecycle, configuration, commands, or MCP tools.

`--project <slug>` selects the project when publishing. If it has not been used before, it exists as soon as the first share is created. Omitting the flag uses the fixed `default` project.

Project slugs are lowercase DNS labels: 1–63 letters, digits, or hyphens, beginning and ending with a letter or digit.

With a custom content domain, each project has its own hostname and shares use paths beneath it:

```text
https://<project>.<content-domain>/<unguessable-share-id>/
```

For example:

```text
https://docs.example.com/K7hpx9.../
https://default.example.com/B2qm4a.../
```

Alchemy provisions wildcard DNS and Worker routing once; creating a project is metadata only and never triggers another deploy. The configured content domain should allow first-level wildcard hostnames. Quickshare does not use nested share hostnames such as `<share>.<project>.<content-domain>`.

Without a custom content domain, `workers.dev` uses a path fallback:

```text
https://<content-worker>.workers.dev/<project>/<unguessable-share-id>/
```

A project is also the active-content trust boundary. Separate project hostnames are separate browser origins. Shares within one project share an origin, so the operator should group only content they are willing to trust together. The `workers.dev` path fallback does not provide cross-project origin isolation.

### Publishing

The CLI accepts:

- A single HTML (or other static) file, stored as `index.html`.
- A directory of static assets (HTML, CSS, JS, images, and similar).
- A Markdown file (`.md` / `.markdown`), rendered to HTML at publish time in the CLI, then stored as a static page.

Markdown is not rendered on request. The Content Worker only serves files.

Each share gets an unguessable ID and URL. Publishing without an existing share ID always creates a new share; Quickshare does not infer remote identity from a local path, filename, or content hash.

The `update` operation changes an existing share. It may replace the content, patch explicitly supplied settings such as TTL or access policy, or do both at once. It retains the share's ID, project, and public URL. Omitted settings remain unchanged, and `--ttl none` removes expiry. Moving a share between projects is not supported in the first version.

Listing, inspecting, updating, and revoking shares go through the same management API as creation.

### Visitor access

Access is optional and per share:

| Flags                              | Policy                                  |
| ---------------------------------- | --------------------------------------- |
| none                               | Anyone with the URL                     |
| `--password <shared>`              | Shared password                         |
| `--password <shared> --emails a,b` | Listed emails plus that shared password |
| `--emails a,b --passwords p1,p2`   | Listed emails with their own passwords  |

`--emails` is an allowlist, not an invitation or proof of mailbox ownership. Visitors may claim a listed email and authenticate with its accepted password. Quickshare does not verify email ownership or send mail.

Protected shares show a small platform login form and set a host-only cookie after a successful check. Passwords are stored as hashes only.

### Lifetime

A share may have a TTL. After expiry, every visitor request is denied. A cron job later deletes the share's R2 objects and metadata. Expiry is the access rule; object deletion is cleanup.

TTL is part of create or update rather than a separate command. Updating content and TTL together applies both to the same share revision and URL.

### Management API lock

Every deploy preserves or mints the API key (`Alchemy.Random`) and prints it with the API URL. The CLI and MCP send `Authorization: Bearer <key>`. There is no user directory and no OAuth on the service itself.

`quickshare config` only writes that URL and key to a local client file (for example `~/.config/quickshare/config.toml`) so later commands do not need `--url` and `--key`. Environment variables or per-command flags are equivalent.

## Commands

```bash
# Deploy the service (Alchemy).
alchemy deploy
# prints API URL and the current API key

# Save local CLI settings (optional).
quickshare config --url https://quickshare-api.example.workers.dev --key <apiKey>

# Publish into the default or a named project.
quickshare index.html --password this-is-shared
quickshare index.html --project demos --password still-shared --emails test@example.com,test2@example.com
quickshare site/ --project demos --emails test@example.com,test2@example.com --passwords testing1,testing2
quickshare notes.md --project notes --ttl 24h --password this-is-shared

# Update existing content, settings, or both without changing its URL or project.
quickshare update <id> site/
quickshare update <id> --ttl 1h
quickshare update <id> site/ --ttl 24h
quickshare update <id> --ttl none

# Inspect and revoke.
quickshare list
quickshare inspect <id>
quickshare revoke <id>
```

Human-readable output is the default. `--json` is for scripts. `--password-stdin` (or equivalent) should be available so secrets need not appear in shell history.

There are no project-management commands. `list` and `inspect` include the project slug.

MCP keeps the same small surface: `share`, `list`, `inspect`, and `revoke`.

The `share` tool accepts an optional `shareId`:

- Without `shareId`, it creates a share and uses the optional project slug or `default`.
- With `shareId`, it updates that share's supplied content and/or settings while retaining its project and URL.
- Files are bounded inline inputs because the remote MCP server cannot read the client's local filesystem.

## Shape

```text
CLI / MCP
    │  Bearer API key
    ▼
API Worker  ── D1 (projects, share metadata, hashes, expiry)
    │       └── R2 (private versioned files)
    │
    └── POST /mcp   (MCP 2026-07-28, same key)

Visitor
    ▼
<project>.<content-domain>/<share-id>/
    │
    ▼
Content Worker ── read D1 + R2
                └── optional password / email gate
```

Alchemy deploys this stack. Creating a project or share is an API operation, not a new Worker or a new Alchemy apply.

Default URLs can live on `workers.dev` using project paths. A custom domain enables project hostnames and cross-project browser-origin isolation.

## Tech stack

### Application

| Area            | Choice                                                                           |
| --------------- | -------------------------------------------------------------------------------- |
| Language        | TypeScript 7                                                                     |
| Package manager | pnpm 11, Node 24                                                                 |
| Runtime logic   | Effect v4                                                                        |
| Infrastructure  | Alchemy v2 (`alchemy.run.ts` is the only composition root)                       |
| CLI             | Thin HTTP client of the management API                                           |
| MCP             | `@modelcontextprotocol/server` 2.x, spec `2026-07-28`, mounted on the API Worker |
| Lint / format   | Oxlint (type-aware, Effect + anti-slop) and Oxfmt                                |
| Tests           | Vitest with Effect test support                                                  |

Toolchain and versions follow `web-project-base`, without SvelteKit, Vite, Better Auth, or Drizzle-for-auth. There is no dual TypeScript 6/7 compiler.

### Cloudflare

| Resource           | Role                                                   |
| ------------------ | ------------------------------------------------------ |
| API Worker         | Management HTTP API and `/mcp`                         |
| Content Worker     | Project-aware public file serving and visitor login    |
| R2                 | Private object store for versioned share files         |
| D1                 | Project slugs, share metadata, credential hashes, TTL  |
| Cron               | Delete expired, revoked, and superseded share data     |
| Rate Limit binding | Throttle publish and login attempts                    |
| `Alchemy.Random`   | Bootstrap API key and visitor-cookie signing secret    |
| DNS / Worker route | Optional wildcard routing for project custom hostnames |

No Pages, no public R2 bucket, no Workers for Platforms, no Durable Objects, no Queues, no Workflows, no Better Auth, and no Email Routing in the first version.

## Boundaries

- Not a hosted multi-tenant product.
- No web dashboard.
- No product user accounts or Cloudflare Access as the visitor password gate.
- No email verification or outbound invitation email.
- No project-management commands, tools, or per-project infrastructure.
- No automatic replacement based on local paths, filenames, or content hashes.
- No moving an existing share between projects in the first version.
- No per-share or per-project Worker, Website, or Alchemy deploy.
- The operator is responsible for published content and for the trust relationship between shares grouped in one project. A README note should say so.

## Operator setup (intent)

1. Clone the repo, install, and configure Cloudflare credentials for Alchemy.
2. Optionally configure a content domain whose first-level wildcard hostnames will represent projects.
3. `alchemy deploy` — creates the Workers, D1, R2, cron, API key, and optional wildcard routing.
4. Point the CLI at the printed URL and key.
5. Publish with `quickshare`, optionally selecting `--project <slug>`.
