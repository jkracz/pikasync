/**
 * PikaSync normalizer — the single source of truth for the file format.
 *
 * Pure, dependency-light, and runnable both in the Convex isolate and in Node
 * (vitest). Implements the contract in `docs/format-spec.md`:
 *   - parse frontmatter + body
 *   - validate against per-entity schemas
 *   - deterministic canonical serialization (stable key order/quoting)
 *   - content hashing (change detection only)
 *   - ULID generation (offline-safe identity)
 *
 * The Convex mutations wrap these pure functions with the DB write + optimistic
 * concurrency. Nothing else may construct entity content.
 */

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

export class FormatError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "FormatError";
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// ULID + hashing
// ─────────────────────────────────────────────────────────────────────────────

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

/** Generate a 26-char Crockford-base32 ULID (48-bit time + 80-bit randomness). */
export function generateUlid(
	time = Date.now(),
	rnd: () => number = Math.random,
): string {
	let ts = "";
	let t = Math.floor(time);
	for (let i = 0; i < 10; i++) {
		ts = CROCKFORD[t % 32] + ts;
		t = Math.floor(t / 32);
	}
	let r = "";
	for (let i = 0; i < 16; i++) {
		r += CROCKFORD[Math.floor(rnd() * 32) % 32];
	}
	return ts + r;
}

/** FNV-1a 64-bit hex hash. Used only for change detection, not security. */
export function contentHash(s: string): string {
	const mask = 0xffffffffffffffffn;
	let h = 0xcbf29ce484222325n;
	const prime = 0x100000001b3n;
	for (let i = 0; i < s.length; i++) {
		h ^= BigInt(s.charCodeAt(i));
		h = (h * prime) & mask;
	}
	return h.toString(16).padStart(16, "0");
}

// ─────────────────────────────────────────────────────────────────────────────
// Field validation (zod) — camelCase internal shapes
// ─────────────────────────────────────────────────────────────────────────────

const ulid = z.string().regex(ULID_RE, "must be a 26-char ULID");
const dateTime = z.preprocess(
	(v) => (v instanceof Date ? v.toISOString() : v),
	z.string(),
);
const dateOnly = z.preprocess(
	(v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v),
	z.string(),
);

const issueSchema = z.object({
	id: ulid,
	identifier: z.string().optional(),
	type: z.literal("issue"),
	title: z.string().min(1, "title is required"),
	status: z.enum([
		"backlog",
		"todo",
		"in_progress",
		"in_review",
		"done",
		"canceled",
	]),
	team: z.string().min(1, "team is required"),
	assignee: z.string().nullish(),
	priority: z.enum(["none", "low", "medium", "high", "urgent"]).default("none"),
	estimate: z.number().nullish(),
	labels: z.array(z.string()).default([]),
	project: ulid.nullish(),
	milestone: ulid.nullish(),
	plan: ulid.nullish(),
	planSection: z.string().nullish(),
	parent: ulid.nullish(),
	blockedBy: z.array(ulid).default([]),
	due: dateOnly.nullish(),
	created: dateTime.optional(),
	updated: dateTime.optional(),
});

const docSchema = z.object({
	id: ulid,
	identifier: z.string().optional(),
	type: z.literal("doc"),
	title: z.string().min(1, "title is required"),
	team: z.string().nullish(),
	project: ulid.nullish(),
	created: dateTime.optional(),
	updated: dateTime.optional(),
});

const planSchema = z.object({
	id: ulid,
	identifier: z.string().optional(),
	type: z.literal("plan"),
	title: z.string().min(1, "title is required"),
	team: z.string().nullish(),
	project: ulid.nullish(),
	parent: ulid.nullish(),
	planStatus: z
		.enum(["draft", "approved", "active", "superseded", "done"])
		.default("draft"),
	supersedes: ulid.nullish(),
	executedVersion: z.number().nullish(),
	created: dateTime.optional(),
	updated: dateTime.optional(),
});

export type IssueFields = z.infer<typeof issueSchema>;
export type DocFields = z.infer<typeof docSchema>;
export type PlanFields = z.infer<typeof planSchema>;
export type DocumentFields = DocFields | PlanFields;
export type EntityType = "issue" | "doc" | "plan";

// ─────────────────────────────────────────────────────────────────────────────
// Canonical serialization (§5 of the spec)
// ─────────────────────────────────────────────────────────────────────────────

/** [internal camelCase field, on-disk frontmatter key] in canonical order. */
const ISSUE_ORDER: [string, string][] = [
	["id", "id"],
	["identifier", "identifier"],
	["type", "type"],
	["title", "title"],
	["status", "status"],
	["team", "team"],
	["assignee", "assignee"],
	["priority", "priority"],
	["estimate", "estimate"],
	["labels", "labels"],
	["project", "project"],
	["milestone", "milestone"],
	["plan", "plan"],
	["planSection", "plan_section"],
	["parent", "parent"],
	["blockedBy", "blocked_by"],
	["due", "due"],
	["created", "created"],
	["updated", "updated"],
];

const DOC_ORDER: [string, string][] = [
	["id", "id"],
	["identifier", "identifier"],
	["type", "type"],
	["title", "title"],
	["team", "team"],
	["project", "project"],
	["created", "created"],
	["updated", "updated"],
];

const PLAN_ORDER: [string, string][] = [
	["id", "id"],
	["identifier", "identifier"],
	["type", "type"],
	["title", "title"],
	["team", "team"],
	["project", "project"],
	["parent", "parent"],
	["planStatus", "status"],
	["supersedes", "supersedes"],
	["executedVersion", "executed_version"],
	["created", "created"],
	["updated", "updated"],
];

/** Canonical field orders by entity type (for separating known vs unknown keys). */
const ORDERS: Record<string, [string, string][]> = {
	issue: ISSUE_ORDER,
	doc: DOC_ORDER,
	plan: PLAN_ORDER,
};

function pickExtra(
	frontmatter: Record<string, unknown>,
	order: [string, string][],
): Record<string, unknown> {
	const known = new Set(order.map(([, file]) => file));
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(frontmatter)) {
		if (!known.has(k) && v !== undefined) out[k] = v;
	}
	return out;
}

/**
 * Unknown ("passthrough") frontmatter fields for a stored raw file — those not
 * in the entity's schema. Write paths that rebuild from structured fields use
 * this so custom fields authored on disk survive a web/CLI edit.
 */
export function extraFields(raw: string): Record<string, unknown> {
	const { frontmatter } = splitRaw(raw);
	const type = typeof frontmatter.type === "string" ? frontmatter.type : "";
	const order = ORDERS[type];
	return order ? pickExtra(frontmatter, order) : {};
}

function needsQuote(s: string): boolean {
	if (s === "") return true;
	if (/^\s|\s$/.test(s)) return true;
	if (/[:#[\]{}&*!|>'"%@`,\n\r\t]/.test(s)) return true;
	if (/^[-?]/.test(s)) return true; // leading YAML indicator chars
	if (/^(true|false|null|yes|no|on|off|~)$/i.test(s)) return true;
	if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return true; // decimal
	if (/^[-+]?0x[0-9a-f]+$/i.test(s)) return true; // hex (YAML 1.1)
	if (/^[-+]?0o[0-7]+$/i.test(s)) return true; // octal (YAML 1.1)
	if (/^[-+]?\.(inf|nan)$/i.test(s)) return true; // float specials
	if (/^\d{4}-\d{2}-\d{2}/.test(s)) return true; // date/time-like
	return false;
}

function quote(s: string): string {
	return `"${s
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\n/g, "\\n")
		.replace(/\r/g, "\\r")
		.replace(/\t/g, "\\t")}"`;
}

function scalar(v: unknown): string {
	if (typeof v === "string") return needsQuote(v) ? quote(v) : v;
	return String(v);
}

function serializeFrontmatter(
	order: [string, string][],
	fields: Record<string, unknown>,
): string {
	const lines: string[] = [];
	for (const [fieldKey, fileKey] of order) {
		const value = fields[fieldKey];
		if (value === undefined || value === null) continue;
		if (Array.isArray(value)) {
			if (value.length === 0) continue;
			lines.push(`${fileKey}: [${value.map(scalar).join(", ")}]`);
		} else {
			lines.push(`${fileKey}: ${scalar(value)}`);
		}
	}
	return lines.join("\n");
}

/**
 * Serialize unknown passthrough fields with the YAML library (handles arbitrary
 * nesting), keys sorted for deterministic output. Preserved verbatim, never
 * validated or indexed.
 */
function serializeExtra(extra: Record<string, unknown>): string {
	const keys = Object.keys(extra)
		.filter((k) => extra[k] !== undefined)
		.sort();
	if (keys.length === 0) return "";
	const ordered: Record<string, unknown> = {};
	for (const k of keys) ordered[k] = extra[k];
	return stringifyYaml(ordered).replace(/\n+$/, "");
}

function assemble(frontmatter: string, body: string): string {
	const b = body.replace(/\s+$/, "");
	return b.length > 0
		? `---\n${frontmatter}\n---\n\n${b}\n`
		: `---\n${frontmatter}\n---\n`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalized results
// ─────────────────────────────────────────────────────────────────────────────

export interface NormalizedIssue {
	kind: "issue";
	fields: IssueFields;
	/** Unknown passthrough frontmatter, preserved verbatim (not validated/indexed). */
	extra: Record<string, unknown>;
	body: string;
	content: string;
	contentHash: string;
}

export interface NormalizedDocument {
	kind: "document";
	docType: "doc" | "plan";
	fields: DocumentFields;
	/** Unknown passthrough frontmatter, preserved verbatim (not validated/indexed). */
	extra: Record<string, unknown>;
	body: string;
	content: string;
	contentHash: string;
}

export type Normalized = NormalizedIssue | NormalizedDocument;

/** Drop null/undefined so derived columns are `T | undefined`, never null. */
function strip<T extends Record<string, unknown>>(obj: T): T {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(obj)) {
		if (v !== null && v !== undefined) out[k] = v;
	}
	return out as T;
}

function finishIssue(
	fields: IssueFields,
	body: string,
	extra: Record<string, unknown>,
): NormalizedIssue {
	const clean = strip(fields) as IssueFields;
	const cleanBody = body.replace(/\s+$/, "");
	const known = serializeFrontmatter(ISSUE_ORDER, clean);
	const extraStr = serializeExtra(extra);
	const content = assemble(
		extraStr ? `${known}\n${extraStr}` : known,
		cleanBody,
	);
	return {
		kind: "issue",
		fields: clean,
		extra,
		body: cleanBody,
		content,
		contentHash: contentHash(content),
	};
}

function finishDocument(
	fields: DocumentFields,
	body: string,
	extra: Record<string, unknown>,
): NormalizedDocument {
	const clean = strip(fields as Record<string, unknown>) as DocumentFields;
	const cleanBody = body.replace(/\s+$/, "");
	const order = clean.type === "plan" ? PLAN_ORDER : DOC_ORDER;
	const known = serializeFrontmatter(order, clean);
	const extraStr = serializeExtra(extra);
	const content = assemble(
		extraStr ? `${known}\n${extraStr}` : known,
		cleanBody,
	);
	return {
		kind: "document",
		docType: clean.type,
		fields: clean,
		extra,
		body: cleanBody,
		content,
		contentHash: contentHash(content),
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Public builders
// ─────────────────────────────────────────────────────────────────────────────

/** Build a normalized issue from structured fields (web/CLI path). */
export function buildIssue(
	input: unknown,
	body: string,
	extra: Record<string, unknown> = {},
): NormalizedIssue {
	const parsed = issueSchema.safeParse(input);
	if (!parsed.success) {
		throw new FormatError(
			`invalid issue: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
		);
	}
	return finishIssue(parsed.data, body, extra);
}

/** Build a normalized document/plan from structured fields (web/CLI path). */
export function buildDocument(
	input: unknown,
	body: string,
	extra: Record<string, unknown> = {},
): NormalizedDocument {
	const obj = input as { type?: unknown };
	const schema = obj?.type === "plan" ? planSchema : docSchema;
	const parsed = schema.safeParse(input);
	if (!parsed.success) {
		throw new FormatError(
			`invalid document: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
		);
	}
	return finishDocument(parsed.data, body, extra);
}

// ─────────────────────────────────────────────────────────────────────────────
// Raw parsing (file-sync path; used by tests + the future daemon)
// ─────────────────────────────────────────────────────────────────────────────

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

/** Split a raw file into its (file-keyed) frontmatter object and body. */
export function splitRaw(raw: string): {
	frontmatter: Record<string, unknown>;
	body: string;
} {
	// Canonical in-memory form is LF; normalize CRLF (Windows editors/daemons).
	const normalized = raw.replace(/\r\n/g, "\n");
	const m = normalized.match(FRONTMATTER_RE);
	if (!m) return { frontmatter: {}, body: normalized };
	const fmText = m[1] ?? "";
	const body = (m[2] ?? "").replace(/^\n/, "");
	const parsed = fmText.trim() === "" ? {} : parseYaml(fmText);
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new FormatError("frontmatter must be a YAML mapping");
	}
	return { frontmatter: parsed as Record<string, unknown>, body };
}

/** Map on-disk frontmatter keys to internal camelCase fields. */
function mapKeys(
	order: [string, string][],
	frontmatter: Record<string, unknown>,
): Record<string, unknown> {
	const fileToField = new Map(order.map(([fk, file]) => [file, fk]));
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(frontmatter)) {
		const fieldKey = fileToField.get(k);
		if (fieldKey) out[fieldKey] = v;
	}
	return out;
}

/** Parse + validate a raw Markdown file into a normalized entity. */
export function parseEntity(raw: string): Normalized {
	const { frontmatter, body } = splitRaw(raw);
	const type = frontmatter.type;
	if (type === "issue") {
		return buildIssue(
			mapKeys(ISSUE_ORDER, frontmatter),
			body,
			pickExtra(frontmatter, ISSUE_ORDER),
		);
	}
	if (type === "plan") {
		return buildDocument(
			mapKeys(PLAN_ORDER, frontmatter),
			body,
			pickExtra(frontmatter, PLAN_ORDER),
		);
	}
	if (type === "doc") {
		return buildDocument(
			mapKeys(DOC_ORDER, frontmatter),
			body,
			pickExtra(frontmatter, DOC_ORDER),
		);
	}
	throw new FormatError(
		`unknown or missing entity type: ${JSON.stringify(type)}`,
	);
}
