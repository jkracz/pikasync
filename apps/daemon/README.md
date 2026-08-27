# `pika` — the PikaSync sync daemon & CLI

`pika` keeps a repo's `.pikasync/` files (issues, docs, plans) in sync with the
PikaSync cloud over a token-authenticated API, and links git commits to issues.

## Build

```bash
cd apps/daemon
cargo build --release        # binary at target/release/pika
```

## Connect a repo

1. In the web app, open **Settings → Device tokens**, create a token, and copy the
   `pika init …` command it shows.
2. Run it at your repo root:

   ```bash
   pika init --url https://<deployment>.convex.cloud --token pk_…
   ```

   This creates `.pikasync/` (issues/, docs/, a self-ignoring `.gitignore`), adds
   `.pikasync/` to the repo's root `.gitignore`, and records the link.

## Commands

| Command | What it does |
| --- | --- |
| `pika status` | Show the link + pending local changes. |
| `pika sync` | One-shot: link new commits, push local changes, pull remote changes. |
| `pika watch [--interval N]` | Continuously sync every N seconds (default 5). |
| `pika issue new "Title" [--team KEY] [--status S] [--priority P]` | Create an issue (the cloud assigns the identifier) and sync it. |
| `pika skill install [--dir PATH]` | Write the agent skill to `.claude/skills/pikasync/SKILL.md`. |

## How it works

- **Identity.** Files are identified by a ULID in frontmatter (`id`). New files get
  one injected automatically; the cloud assigns the display identifier (e.g. `ENG-1`).
- **Canonicalization.** The cloud is the single normalizer: on push it returns the
  canonical file content, which `pika` writes back to disk.
- **Conflicts.** If a push hits a stale version, `pika` writes a sibling
  `*.conflict-remote.md` with the remote content and leaves your file untouched —
  merge it and re-sync.
- **Git-awareness.** Commit messages that mention an identifier (e.g. `ENG-123`) are
  linked to the issue; `fix/close/resolve ENG-123` moves it to **done**.
- **State.** Per-machine sync state lives in SQLite under the OS data dir
  (`~/Library/Application Support/PikaSync/` on macOS), never in the synced tree.

The on-disk file format is specified in [`docs/format-spec.md`](../../docs/format-spec.md).
