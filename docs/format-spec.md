# PikaSync File Format Spec (v0 — P0 subset)

This is the contract between the files on disk, the sync daemon, and the Convex
backend. It is implemented by the **normalizer** in `@pikasync/backend`
(`convex/lib/format.ts`) and will later be implemented by the Rust daemon.

> Status: **P0 subset.** Issues and documents (incl. plans) are specified here.
> Projects, milestones, cycles, PFM directives, and comments are sketched but
> deferred to later phases. See `.context/pikasync-plan.html`.

---

## 1. The cardinal rule

**The raw Markdown body is the content authority. Everything else is derived.**

A PikaSync entity is a UTF-8 Markdown file with a YAML **frontmatter** block followed
by a Markdown **body**. The frontmatter holds structured fields; the body holds prose.

```markdown
---
id: 01J8X2K9Z7QVABCDEF0123456
type: issue
title: Add OAuth login
status: in_progress
...
---

# Add OAuth login

Body in Markdown…
```

Projected/indexed database columns are **always re-derived from the canonical file
content** on every write — they are never independently authoritative. On any
divergence, the body wins and columns are recomputed. **All writes route through one
normalizer** (file sync, web app, CLI) so this can never drift. See §6.

---

## 2. Identity

| field | meaning |
| --- | --- |
| `id` | **ULID**, authoritative, immutable. Generated client-side (offline-safe). Lowercase or uppercase Crockford base32, 26 chars. |
| `identifier` | Human display id, e.g. `ENG-123` = team key + per-team counter. **Configurable** (prefix and start can change) and **not** used for references. Assigned by the cloud on first sync; may be absent/provisional locally. |

All **relationships reference `id` (ULID)**, never `identifier` or filename. The
filename is cosmetic (`issues/ENG-123-add-oauth-login.md`); identity lives in `id`.

---

## 3. Entity types

The `type` field selects the entity and its frontmatter schema. P0 types:

- `issue`
- `doc` — a document
- `plan` — a document subtype (an executable spec; see §3.3)

### 3.1 `issue`

| field | type | required | notes |
| --- | --- | --- | --- |
| `id` | ULID | yes | immutable |
| `identifier` | string | no | e.g. `ENG-123`; cloud-assigned |
| `type` | `"issue"` | yes | |
| `title` | string | yes | non-empty |
| `status` | enum | yes | `backlog \| todo \| in_progress \| in_review \| done \| canceled` |
| `team` | string | yes | team key (e.g. `ENG`); maps to a team |
| `assignee` | string \| null | no | user email or id |
| `priority` | enum | no | `none \| low \| medium \| high \| urgent` (default `none`) |
| `estimate` | number \| null | no | points |
| `labels` | string[] | no | default `[]` |
| `project` | ULID \| null | no | |
| `milestone` | ULID \| null | no | |
| `plan` | ULID \| null | no | the spec this realizes (§3.3) |
| `plan_section` | string \| null | no | anchor within the plan |
| `parent` | ULID \| null | no | parent issue (sub-issues) |
| `blocked_by` | ULID[] | no | default `[]` |
| `due` | date (YYYY-MM-DD) \| null | no | |
| `created` | datetime (ISO 8601) | no | cloud-managed |
| `updated` | datetime (ISO 8601) | no | cloud-managed |

Every parent-like field (`project`, `milestone`, `plan`, `parent`) is **nullable** —
orphan entities are first-class (see "emergent graph" in the plan). The Linear-shaped
hierarchy is one *view* over a typed-edge graph; in P0, edges are captured both as
these frontmatter refs and as `edges` rows for inverse lookups.

### 3.2 `doc`

| field | type | required | notes |
| --- | --- | --- | --- |
| `id` | ULID | yes | |
| `type` | `"doc"` | yes | |
| `title` | string | yes | |
| `team` | string \| null | no | docs may be workspace-level |
| `project` | ULID \| null | no | |
| `created` / `updated` | datetime | no | cloud-managed |

### 3.3 `plan` (a document that is an executable spec)

All `doc` fields, plus:

| field | type | required | notes |
| --- | --- | --- | --- |
| `type` | `"plan"` | yes | |
| `parent` | ULID \| null | no | the issue/milestone/project it plans; null = orphan |
| `status` | enum | no | `draft \| approved \| active \| superseded \| done` (default `draft`) |
| `supersedes` | ULID \| null | no | lineage |
| `executed_version` | number \| null | no | pinned spec version agents committed to |

---

## 4. Body

P0: the body is plain CommonMark + GFM. The richer **PikaSync-Flavored Markdown**
(callouts, milestone blocks, `[[ref]]` wiki-links) is specified and rendered in a
later phase; until then those constructs are treated as ordinary text and round-trip
losslessly.

---

## 5. Canonical serialization

To make hashing and diffs stable, serialization is deterministic:

1. Frontmatter is emitted as a single YAML block delimited by `---` lines.
2. Keys appear in a **fixed order** (the order in the tables above), omitting
   absent optional fields. **`null` is normalized to field-absent** — there is no
   on-disk distinction between "unset" and "explicitly null" in v0; a `null` patch
   clears the field.
3. Scalar strings use plain YAML scalars, but are **double-quoted (with `\n`/`\r`/
   `\t`/`"`/`\` escaped) whenever they would otherwise be ambiguous** to a YAML
   parser — empty, surrounding whitespace, embedded specials/newlines, a leading
   indicator char (`-`, `?`, …), or values that look like numbers (incl. hex/octal/
   `.inf`/`.nan`), booleans, null, or dates. Arrays of scalars use flow style
   (`labels: [auth, backend]`); empty arrays are omitted.
4. Exactly one blank line separates the closing `---` from the body.
5. The body is stored verbatim (only trailing-whitespace normalization on save).
6. **Line endings:** CRLF is normalized to LF on read; the canonical form is LF.
7. **Unknown fields are preserved (passthrough).** Frontmatter keys *not* in an
   entity's schema are kept verbatim — emitted after the known fields, keys
   sorted, serialized via the YAML library (so arbitrary nesting round-trips).
   They are **not** validated, indexed, or queryable. This is the "permissive
   periphery": a safe place for custom fields a human or agent adds. Durable ones
   can later be promoted to first-class, indexed schema fields. (The validated
   *core* fields above are the "strict spine"; identity and security fields stay
   strict.)

`contentHash` is computed over the canonical serialized form (frontmatter + body) and
is used only for change detection (not security). `version` is a monotonic integer
bumped by the cloud on every accepted write.

---

## 6. The normalizer (single write path)

Every write — from the daemon, the web app, or the CLI — goes through one function:

```
normalize(rawOrPatch) →
  1. obtain canonical raw content
     - file sync: parse the provided raw Markdown
     - web/CLI field edit: apply the field patch to the existing entity, re-serialize (§5)
  2. parse frontmatter (YAML) + split body
  3. validate frontmatter against the entity schema (§3); reject on hard errors
  4. canonicalize (§5)
  5. derive indexed columns from frontmatter
  6. write { raw body, derived columns } atomically; bump version; recompute contentHash
```

Pure steps (parse → validate → canonicalize → derive → hash) live in
`convex/lib/format.ts` and are unit-tested without a database. The Convex mutation
wraps them with the DB write and optimistic-concurrency check (`expectedVersion`).

`created` is set once at creation and **reused verbatim on every subsequent write**
so it stays byte-stable; `updated` is refreshed on each write.

**Lifecycle transitions** (archive, delete) set column-only state
(`archivedAt`/`deletedAt`, which are intentionally *not* represented in frontmatter)
and bump `version`. Because they do not alter canonical frontmatter, they do not
re-run the body normalizer.

---

## 7. Optimistic concurrency (sync; mostly P1)

Writes may pass `expectedVersion`. If it matches the stored `version`, the write
applies and `version` increments. If stale, the caller must reconcile (3-way merge in
the daemon; the web app simply re-reads). The full merge/conflict-copy behavior is a
P1 daemon concern; P0 implements the version/hash plumbing and the `expectedVersion`
check.

---

## 8. Deferred (not in P0)

Projects & milestones as authored files, PFM directives & rendering, comments
(per-issue sidecar), generated read-only index/view files, tombstones/trash, and the
on-disk directory layout are specified in the architecture plan and land in later
phases. P0 exercises the **schema + normalizer + cloud CRUD + auth** so the daemon has
a correct contract to sync against.
