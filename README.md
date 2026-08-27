# PikaSync

> **Project management that lives where your code does.**

PikaSync is an open-source, local-first project management tool. Issues, docs, and
plans live as plain Markdown files in a git-ignored `.pikasync/` folder inside your
repo; a lightweight daemon keeps them in sync with a cloud backend and web app — so
coding agents read project context the same way they read code, no integration needed.

See [`product.md`](product.md) for the full pitch and the
[architecture plan](.context/pikasync-plan.html) for the design & roadmap.

## Monorepo layout

| Path | What it is |
| --- | --- |
| `packages/backend` | Convex backend — schema, the Markdown normalizer, Clerk auth, and the token-authenticated sync API. |
| `apps/web` | Web app (TanStack Start + Convex + Clerk + shadcn) — issues, docs/plans, device-token settings. |
| `apps/daemon` | Rust sync daemon + `pika` CLI — two-way file sync + git-commit→issue linking. |
| `docs/` | [`format-spec.md`](docs/format-spec.md) — the file ↔ DB contract. |
| `.context/` | Design docs (the architecture plan). |

## Quickstart

Prereqs: **pnpm** (only), Node, a Convex deployment, a Clerk app, and **Rust/cargo**
for the daemon.

```bash
pnpm install
pnpm dev            # runs the web app + `convex dev` (turbo)
```

Configure environment:

- `apps/web/.env.local`: `VITE_CONVEX_URL`, `VITE_CLERK_PUBLISHABLE_KEY`
- On the Convex deployment: `npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<app>.clerk.accounts.dev`
- In Clerk: a JWT template named `convex` exposing `org_id` / `org_slug` / `org_role` claims

Then build & connect the daemon (details in [`apps/daemon/README.md`](apps/daemon/README.md)):

```bash
cd apps/daemon && cargo build --release
pika init --url <convex-url> --token <device-token>   # token from web Settings → Device tokens
pika watch
```

## Scripts (root)

```bash
pnpm dev         # turbo dev (web + backend)
pnpm lint        # biome lint
pnpm typecheck   # turbo typecheck (backend + web)
pnpm format      # biome format --write
```

Per-package tests: `pnpm --filter @pikasync/backend test` (vitest), `cargo test` in `apps/daemon`.

## Status

**P0 + P1 implemented.** Cloud model + Clerk auth + web CRUD (P0); the Rust sync daemon,
token sync API, git-awareness, and the agent skill (P1) — all verified end-to-end. The
data model's breadth (projects, first-class milestones, plan coverage, Views, comments)
and a native menu-bar GUI are the next phases. See the
[roadmap](.context/pikasync-plan.html) and [`product.md`](product.md).

## License

ISC (see [`LICENSE`](LICENSE)).
