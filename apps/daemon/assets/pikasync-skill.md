---
name: pikasync
description: Work with PikaSync project context — issues, docs, and plans that live as plain files in .pikasync/. Use this when reading what's in scope/blocked, creating or updating issues, writing docs/plans, or referencing tracked work from commits. No API or MCP needed; it's just files synced by the `pika` daemon.
---

# Working in PikaSync

PikaSync keeps a team's project tracking — **issues, documents, and plans** — as plain
Markdown files in a **`.pikasync/`** folder at the repo root. A background daemon (`pika`)
keeps those files in sync with the cloud and web app. So you read and write project context
the same way you read and write code: it's just files in the working tree.

## Where things live

```
.pikasync/
  workspace.json        # which workspace/teams this repo is linked to (read-only)
  index.md              # GENERATED overview — read it to orient; never edit
  issues/   ENG-123.md  # one file per issue
  docs/     <slug>.md   # documents and plans (type: plan)
  *.conflict-remote.md  # a remote copy written when a sync conflict occurred — merge & delete
```

**Read freely.** To understand scope/status, read `.pikasync/index.md` and the relevant
`issues/*.md` / `docs/*.md`. To find work assigned or blocked, grep the frontmatter.

## File format (frontmatter + Markdown body)

Each file has a YAML frontmatter block then a Markdown body. Authoritative fields:

```markdown
---
id: 01J8X2K9Z7QV...      # ULID, immutable. Omit it on new files — the daemon assigns one.
identifier: ENG-123       # display id, assigned by the cloud. Don't invent one.
type: issue               # issue | doc | plan
title: Add OAuth login
status: in_progress       # backlog | todo | in_progress | in_review | done | canceled
team: ENG                 # team key (must be a team this repo syncs)
assignee: joe@team.dev    # optional
priority: high            # none | low | medium | high | urgent
labels: [auth, backend]   # optional
plan: 01J8XP...           # optional: the plan ULID this issue realizes
blocked_by: [01J8X1...]   # optional: issue ULIDs blocking this one
---

# Add OAuth login

Markdown body. Acceptance criteria as a checklist help status be inferred:
- [ ] Google provider
- [ ] GitHub provider
```

The full contract is in `docs/format-spec.md`. The cloud is the canonicalization authority:
after you save a file, the daemon may rewrite it into canonical form (stable field order,
quoting) and fill in `identifier`, `created`, `updated`. That's expected.

## Creating and updating work

**Prefer the CLI for creating issues** (it generates a valid id and returns the identifier):

```bash
pika issue new "Fix login redirect" --team ENG --status todo --priority high
```

You can also **just write a file** to `.pikasync/issues/<anything>.md` with the frontmatter
above (omit `id` — the daemon injects a ULID on the next sync). To **update** an issue, edit
its file and save; to **change status**, set the `status` field; to **delete**, remove the
file (it becomes a tombstone, recoverable).

Sync happens automatically if `pika watch` is running; otherwise run `pika sync` to push your
changes and pull others'. Check `pika status` for pending changes.

## Link your code to issues (git-awareness)

Reference an issue's identifier in commit messages so the work links automatically:

- `git commit -m "Add Google provider for ENG-123"` → records a commit on ENG-123.
- `git commit -m "Fix ENG-123: handle redirect"` (or `closes/resolves ENG-123`) → also moves
  ENG-123 to **done**.

## Etiquette

- **Don't edit** `index.md` or anything under generated views — they're regenerated.
- **Don't invent** `id` or `identifier` values; let the system assign them.
- **Keep frontmatter valid** (the fields/enums above). Invalid frontmatter is rejected on sync.
- If you see a `*.conflict-remote.md` file, the remote had a competing change — merge it into
  the real file and delete the conflict copy.
- Only reference teams this repo actually syncs (see `workspace.json`).
