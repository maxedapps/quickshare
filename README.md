# Quickshare

Self-hosted publishing of static files, static sites, and Markdown onto the operator's own Cloudflare account.

There is no operator dashboard. After Alchemy deploys the stack, the interfaces are an HTTP API, a CLI that talks to that API, an MCP server, and a visitor Content Worker in `apps/web`.

The operator is responsible for what they host.

See [PROJECT.md](./PROJECT.md) for goals, commands, and boundaries. This repository is the initial toolchain and stack skeleton; publish, access-control, and MCP tools are not implemented yet. D1 will use Drizzle through Alchemy later. Shared workspace packages are added only when two or more apps need the same module.

## Setup

Use Node 24 and pnpm 11.22.0.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
```

The install runs the idempotent Effect TSGO patch step for TypeScript 7 and Oxlint.

## Local development

```sh
pnpm dev
```

This runs Alchemy with local state at stage `local`. The script supplies an inert account ID and invalid token because Alchemy beta.72 validates provider environment variables even for local resources; they cannot authenticate to Cloudflare. Local state lives in ignored `.alchemy/`.

Cloud plan/deploy requires explicit operator intent, valid credentials, and a reviewed stage:

```sh
pnpm exec alchemy plan --stage preview
pnpm exec alchemy deploy --stage preview
```

## Commands

| Command          | Purpose                                             |
| ---------------- | --------------------------------------------------- |
| `pnpm dev`       | Start the local Alchemy environment.                |
| `pnpm typecheck` | Check TypeScript with TS7 / TSGO.                   |
| `pnpm lint`      | Run type-aware Oxlint, Effect, and anti-slop rules. |
| `pnpm format`    | Format supported files with Oxfmt.                  |
| `pnpm test`      | Run Vitest.                                         |
| `pnpm check`     | Run typecheck, format, lint, and tests.             |

## TypeScript and code quality

This project uses TypeScript 7 only. There is no TypeScript 6 package.

`@effect/tsgo` patches the exact supported TS7, Oxlint, and `oxlint-tsgolint` binaries after installation. Its recommended Oxlint preset supplies Effect-aware diagnostics and type-aware linting. Keep these versions synchronized as one compatibility set:

- `@effect/tsgo@0.36.5`
- `typescript@7.0.2`
- `oxlint@1.78.0`
- `oxlint-tsgolint@7.0.2001`

The `prepare` script is idempotent and reapplies Effect's supported patches after installation.

The local anti-slop plugin is vendored at `tools/oxlint/anti-slop/` from the upstream commit recorded in `PROVENANCE.md`; all 15 rules are errors. `.plans/`, `.reviews/`, `.reports/`, and `reports/` are excluded from linting and formatting.
