# PikaSync web app

The PikaSync web client — a fast, Linear-grade interface over the same data the daemon
syncs to files. Built with **TanStack Start** (SSR), **Convex** (`@convex-dev/react-query`),
**Clerk** auth, and **shadcn/ui** (new-york). Backend lives in
[`packages/backend`](../../packages/backend); see the root [README](../../README.md).

## Develop

```bash
pnpm dev        # vite dev on http://localhost:4217
pnpm build      # production build (Nitro server output)
pnpm test       # vitest
pnpm check      # biome lint + tsc
pnpm generate-routes   # regenerate routeTree.gen.ts (tsr) after adding routes
```

## Environment (`.env.local`)

Validated at runtime by `src/env.ts` (`@t3-oss/env-core`):

| Var | Required | Purpose |
| --- | --- | --- |
| `VITE_CONVEX_URL` | yes | Convex deployment URL the app talks to. |
| `VITE_CLERK_PUBLISHABLE_KEY` | no | Enables sign-in. Without it the app boots but shows a setup notice. |
| `VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST` | no | Analytics. |

Auth also requires, on the **Convex deployment**, `CLERK_JWT_ISSUER_DOMAIN` and a Clerk
JWT template named `convex` (with `org_id`/`org_slug`/`org_role` claims). See the backend
[README](../../packages/backend/convex/README.md).

## Structure

- `src/router.tsx` — wires Convex + Clerk (`ConvexProviderWithClerk`), falling back to a
  plain Convex client when no Clerk key is set.
- `src/routes/__root.tsx` — wraps the app in `AuthGate` → `ActiveTeamProvider` → `AppShell`.
- `src/components/` — `auth-gate` (sign-in / provisioning / org selection), `app-shell`
  (nav + team switcher), `app-context` (active team), and `ui/` (shadcn).
- Routes: `/issues`, `/issues/$issueId`, `/docs`, `/docs/$docId`, `/settings` (device tokens).

Add shadcn components with `pnpm dlx shadcn@latest add <name>`.
