# PikaSync

> **Project management that lives where your code does.**

PikaSync is an open-source, **local-first** project management tool. Issues, projects,
milestones, documents, and AI-generated plans live as plain **Markdown files** in a folder
inside your repository. A lightweight background **daemon** keeps those files in sync with a
cloud backend and a web app — so your coding agents can read project context the same way
they read code: **no integrations, no MCP setup, no context switching.**

And because the work and its context sit side by side where PikaSync can see them, it does
something no cloud tool can: it **keeps the picture of your project true by itself** — even as
agents move faster than anyone could keep tickets updated by hand.

---

## The problem

Project tracking lives in the cloud. Coding is local-first.

You pull the code down, all of the actual work happens on your machine, and then you push
your changes back up. But the context that work depends on — what's in scope, what's blocked,
what the spec says — sits on the other side of that divide, locked inside a web app behind an
API. An AI agent can only reach it through a bespoke integration or an MCP server, if at all.

## The differentiated pitch

Every other project management tool was built for humans and bolted AI on afterward.
PikaSync is built for the way software actually gets written today — where an AI agent needs
to know what's in scope, what's blocked, and what the spec says, without being handed a
special integration to do it. **The files are just there, wherever you're working.**

When project context is plain files in your working tree, the repo *is* the integration. An
agent grepping `.pikasync/issues/` needs zero credentials and zero API surface. A human can
open the same files in any editor. Changes flow back up to the team automatically.

---

## The north star: a system of record that maintains itself

Linear is a system of record that **humans maintain**. PikaSync is a system of record that
**maintains itself** by observing the work.

When agents do a large share of the work, the bottleneck stops being *doing* and becomes
*knowing the state of what's been done*. Volume and velocity explode, and no one can keep
statuses, relationships, and timelines current by hand. So the picture — what's shipped,
what's in flight, what's blocked, what's drifting, whether the timeline holds — has to be
**derived continuously, not entered.** Think of it as **observability for your project**: just
as APM infers system health from telemetry instead of asking you to report it, PikaSync infers
project state from the actual artifacts — issues, plans, and (because it lives in the repo) the
code itself.

This is the differentiator, and it's **downstream of the architecture**: only a tool that
lives in the repo can correlate *intent* (plans and issues) with *reality* (commits, branches,
PRs) and keep the record true as a side effect of work happening. Matching Linear's features is
table stakes; the self-maintaining picture is the moat.

One rule keeps it trustworthy: **AI proposes, the picture always shows its provenance, and
humans or agents can correct it — never silent, never unaccountable.** Trust is earned by being
inspectable, not by being confident.

---

## How it works

1. **Files.** A git-ignored `.pikasync/` folder inside your repo holds your issues, projects,
   and docs as Markdown files with structured YAML frontmatter. Humans and agents read and
   edit them like any other file.
2. **Daemon.** A lightweight background process (with a menu-bar app and a CLI) watches the
   folder, reconciles changes in both directions, and resolves conflicts losslessly.
3. **Cloud (Convex).** The shared **convergence authority** — where everyone's changes meet,
   where the web app reads and writes in real time, and where access control lives. Local
   files remain authoritative for your local edits until they sync.
4. **Web app.** A fast, Linear-grade interface over the same data for planning, filtering
   (Views), and working with teammates who'd rather not live in files.
5. **Agent skill.** A packaged skill (shipped into `.claude/skills` / `.agents/skills`, like
   any other) teaches coding agents the format, the workflows, and the etiquette for working
   inside PikaSync — and for keeping the record honest as they work.

```
   ┌─────────────────────────────┐        ┌──────────────────────┐
   │  Convex  (convergence hub)  │◀──────▶│  Web app (Views, edit) │
   └─────────────┬───────────────┘        └──────────────────────┘
                 │  websocket / mutations
   ┌─────────────▼───────────────┐
   │  Sync daemon (menu bar + CLI)│  ← only thing that touches the filesystem
   └─────────────┬───────────────┘
                 │  read / write files
   ┌─────────────▼───────────────┐        ┌──────────────────────┐
   │  .pikasync/ in your repo     │◀──────▶│  Your agent & editor   │
   │  issues/ projects/ docs/     │        │  (no API, no MCP)      │
   └─────────────────────────────┘        └──────────────────────┘
```

---

## Core concepts

PikaSync adopts Linear's well-honed conceptual model as its familiar surface, and changes
*where the data lives* and *how the picture stays true*.

| Concept | What it is |
| --- | --- |
| **Workspace** | Top-level container for a company; holds all teams, issues, and docs. |
| **Team** | A group that works together; owns its statuses and settings. Repos subscribe to teams/projects. |
| **Issue** | The atomic unit of work — a task in plain language. One Markdown file. |
| **Project** | Issues grouped toward a specific, time-bound deliverable. Has an overview doc. |
| **Milestone** | A first-class, project-scoped stage of completion with an order, target date, and progress. |
| **Document** | A standalone rich doc — a spec, a note, a decision record. |
| **Plan** | A document that acts as an *executable spec of record* — attached to whatever it plans (issue, milestone, or project), versioned, and traceable to the work that fulfills it. |
| **Label / Status / Priority** | Issue properties used for organization and workflow. |
| **View** | A saved, filtered query over issues — computed, not stored as a file (the daemon can also materialize read-only index files for agents). |

These nouns are how PikaSync *presents* — a familiar, Linear-shaped surface. Underneath, the
real model is looser and more powerful (see "Beyond Linear" below).

---

## Plans & spec-driven execution

Today, AI planning sessions are ephemeral — they evaporate in a chat window. PikaSync turns
them into **durable, synced, attached-to-the-work, version-traced specs**. Because a plan lives
in the repo, the agent that *wrote* it and the agent that *executes* it read the same file.

A plan attaches to whatever it plans, and its parent sets its altitude — a whole project, a
milestone, or a single issue (an agent's implementation plan for one ticket). A plan can also
start with no parent and later be promoted, spawning the work it describes. Plans carry a
lifecycle (`draft → approved → active → superseded`) and a pinned "executed version."

The payoff is **bidirectional traceability**: when issues point back to the plan section they
realize, PikaSync computes, for any plan, *what got executed and what didn't* — the first
concrete step toward the self-maintaining picture. This is spec-driven development, supercharged
for an era where the spec is often written and executed by AI.

## Beyond Linear: an emergent graph

Linear is a rigid tree — legible for humans, but the wrong shape for an agent world where work
is captured fast and structure should emerge later. PikaSync models a **graph of typed edges**
(`implements`, `blocks`, `belongs-to`, `relates-to`) and renders the familiar Linear tree as
one *view* over it. Every parent is optional: orphan issues, parentless plans, and floating
docs are first-class. **Capture first, organize continuously** — with AI as a continuous
librarian that proposes structure (cluster these orphans into a project? link this issue to
that plan?) and writes the relationships directly, because they're just references in files.

---

## The format

**Markdown + YAML frontmatter is the canonical, on-disk source of truth.** It's the native
language of LLMs, it diffs cleanly, and any human can edit it in any editor. Frontmatter holds
the structured fields (status, assignee, priority, relations); the body holds the prose.

**HTML is a render/export target, never the stored source.** The web app renders Markdown to
beautiful HTML, and we extend Markdown with a small set of components — *PikaSync-Flavored
Markdown* — for callouts, milestones, diagrams, and `[[ISSUE-123]]` links that stay perfectly
readable as plain text.

---

## Open source & business model

PikaSync is **fully open source**. You can self-host the backend (Convex is self-hostable) or
point the daemon at Convex's cloud — your choice. The commercial offering is a **hosted
PikaSync** for teams and larger businesses that would rather not run any infrastructure.

---

## Status

**P0 + P1 implemented** (against a Convex dev deployment):

- **Cloud backend** (Convex): workspaces/teams/issues/docs/plans with Clerk auth, server-side
  team-boundary authorization, a single Markdown normalizer, optimistic concurrency, and a
  token-authenticated sync API.
- **Web app** (`apps/web`): issues + docs/plans CRUD with Markdown preview, plus device-token
  settings for connecting the daemon.
- **Sync daemon + CLI** (`apps/daemon`, Rust): `pika init / status / sync / watch / issue new`,
  two-way file sync, lossless conflict copies, and git-commit → issue linking (a commit that
  says `fix ENG-123` closes the issue).
- **Agent skill** (`pika skill install`) teaching coding agents the file format and workflows.

The full architecture, data model, security model, and roadmap live in
[`.context/pikasync-plan.html`](.context/pikasync-plan.html). The file-format contract is in
[`docs/format-spec.md`](docs/format-spec.md), and daemon usage in
[`apps/daemon/README.md`](apps/daemon/README.md).
