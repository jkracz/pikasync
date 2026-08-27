# PikaSync Convex backend

The cloud backend: the source-of-record for workspaces, teams, issues, documents/plans,
and the **single Markdown normalizer** that both the web app and the sync daemon write
through. See the root [README](../../../README.md) and the file-format contract in
[`docs/format-spec.md`](../../../docs/format-spec.md).

## Layout

| File | Purpose |
| --- | --- |
| `schema.ts` | Tables: `workspaces`, `workspaceMembers`, `teams`, `teamMembers`, `users`, `issues`, `documents`, `edges` (typed-edge graph), `events` (activity, with human/agent actor), `deviceTokens`. |
| `lib/format.ts` | The normalizer — frontmatter parse/validate (zod), deterministic canonical serialization, ULID generation, content hashing. |
| `lib/auth.ts` | Clerk identity → user/workspace/team resolution + **server-side team-boundary authorization** (every read/write is gated). |
| `lib/write.ts` | Maps normalized content → DB columns; edge sync. |
| `lib/token.ts` | Device-token hashing + commit-message identifier parsing. |
| `auth.config.ts` | Clerk provider (`applicationID: "convex"`). |
| `issues.ts`, `documents.ts`, `teams.ts`, `users.ts`, `events.ts`, `deviceTokens.ts` | Web-facing queries/mutations (Clerk-authed). |
| `sync.ts` | The **daemon/CLI sync API** — `push` / `pull` / `hello` / `linkCommits` actions, authenticated by a device token (not a Clerk JWT), reusing the same normalizer. |

`convex.config.ts` installs the `@posthog/convex` and `@convex-dev/aggregate` components.

## The invariant

The raw Markdown content is the authority; projected columns are always re-derived from
it, and **every write (web, CLI, daemon) routes through one normalizer**, so a file edit
and a web edit converge on byte-identical content. Details in
[`docs/format-spec.md`](../../../docs/format-spec.md).

## Develop

```bash
pnpm dev        # convex dev (push + codegen, watch)
pnpm test       # vitest (convex-test, edge-runtime)
pnpm check      # biome lint + tsc -p convex
```

Required deployment env: `CLERK_JWT_ISSUER_DOMAIN` (the Clerk Frontend API URL). A Clerk
JWT template named `convex` must expose `org_id` / `org_slug` / `org_role` claims so the
backend can map a Clerk org → workspace and enforce team membership.
