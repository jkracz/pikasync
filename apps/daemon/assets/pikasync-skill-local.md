---
name: pikasync
description: Track this project's work as plain files in .pikasync/ — issues, docs, plans, and decisions. Use when starting work (read context first), creating or updating issues, capturing specs/decisions, or recording what you tried and why. The folder is the project's working memory; keep it current as you work. Local-only, no tooling required — it's just Markdown files.
---

# Working in `.pikasync/` (local, no-tooling edition)

This project keeps its own tracking as plain Markdown files in a **`.pikasync/`** folder
at the repo root. There's no app, daemon, or sync — just files you read and write the same
way you read and write code. Treat the folder as the project's durable memory: what's in
scope, what's in progress, what's blocked, what was decided, and *why*.

## Layout

```
.pikasync/
  index.md            # optional, agent-maintained: a short table of open work
  issues/<slug>.md    # one file per unit of work
  docs/<slug>.md      # specs, notes, decisions
  plans/<slug>.md     # a plan = a doc you intend to execute
```

Filenames are kebab-case slugs (`issues/add-oauth-login.md`). The slug is the id —
**don't rename files when status changes** (it breaks links); just edit the frontmatter.

## File format

A YAML frontmatter block, then a Markdown body. Keep frontmatter **minimal**:

```markdown
---
type: issue            # issue | doc | plan
title: Add OAuth login
status: in_progress    # backlog | todo | in_progress | in_review | done | canceled
priority: high         # optional: low | medium | high | urgent
tags: [auth, backend]  # optional
---

# Add OAuth login

Why: users want SSO before launch.

## Acceptance
- [ ] Google provider
- [ ] GitHub provider

## Notes
(What you tried, decisions, dead-ends — the highest-value content for the next session.)
```

For `doc`/`plan` files, `status` is optional (for plans use `draft | active | done`).
You may add **any custom fields** you find useful (`estimate: 3`, `risk: high`,
`blocked_by: add-db-migration`) — there's no validator, so just stay tidy and consistent.

## Workflow

1. **Orient first.** Before starting work, read `.pikasync/index.md` (if present) and skim
   `issues/` so you know current scope and status. Don't duplicate existing items.
2. **Create** a unit of work as `issues/<slug>.md` with the frontmatter above.
3. **Keep it live.** As you make progress, update `status`, check off acceptance items, and
   jot intent/decisions/dead-ends in the body. Record *why*, not just *what*.
4. **Finish** by setting `status: done` (don't delete — the history is the point).
5. **Capture knowledge** that outlives a task as `docs/` (specs, decisions) or `plans/`
   (something to execute). Link an issue to the plan it realizes.
6. **Cross-link** with relative links or `[[slug]]`, e.g. "blocked by [[add-db-migration]]".
7. **Tie code to work**: mention the slug in commit messages, e.g.
   `Add Google provider (add-oauth-login)`, so changes trace back to the item.
8. **Maintain `index.md`** (optional but recommended): a small table of open issues + status,
   regenerated when it drifts. Mark it clearly as generated.

## Etiquette

- The folder is **working memory** — stale notes are worse than none. Keep it current.
- Keep frontmatter minimal and consistent; don't invent ceremony (no numeric IDs, no
  required fields beyond `type` + `title` + `status`).
- Prefer capturing **intent and decisions** over restating the diff.
- This is local + single-project. If it earns its keep, a synced/multi-user version can
  layer on top *without changing this file model* — so the habits you build here carry over.
