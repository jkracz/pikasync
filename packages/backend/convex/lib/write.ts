/**
 * Normalizer-backed write helpers. These translate a `Normalized*` (from
 * `format.ts`) into the database column shape and keep the typed-edge graph in
 * sync. They are the only place that maps normalized content → DB columns.
 */
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { NormalizedDocument, NormalizedIssue } from "./format";

/**
 * Field-patch semantics for updates: `undefined` arg = keep existing; explicit
 * `null` = clear; a value = set. Returns the value for a `T | undefined` column.
 */
export function clearable<T>(
	arg: T | null | undefined,
	existing: T | undefined,
): T | undefined {
	return arg === undefined ? existing : (arg ?? undefined);
}

interface IssueBase {
	workspaceId: Id<"workspaces">;
	teamId: Id<"teams">;
	identifier: string;
	number: number;
	version: number;
	updatedAt: number;
	archivedAt?: number;
	deletedAt?: number;
}

/** Map a normalized issue + identity/base fields to the full `issues` column set. */
export function issueColumns(n: NormalizedIssue, base: IssueBase) {
	const f = n.fields;
	return {
		workspaceId: base.workspaceId,
		teamId: base.teamId,
		ulid: f.id,
		identifier: base.identifier,
		number: base.number,
		title: f.title,
		status: f.status,
		priority: f.priority,
		assignee: f.assignee ?? undefined,
		estimate: f.estimate ?? undefined,
		labels: f.labels ?? [],
		due: f.due ?? undefined,
		project: f.project ?? undefined,
		milestone: f.milestone ?? undefined,
		plan: f.plan ?? undefined,
		planSection: f.planSection ?? undefined,
		parent: f.parent ?? undefined,
		blockedBy: f.blockedBy ?? [],
		content: n.content,
		body: n.body,
		contentHash: n.contentHash,
		version: base.version,
		updatedAt: base.updatedAt,
		archivedAt: base.archivedAt,
		deletedAt: base.deletedAt,
	};
}

interface DocBase {
	workspaceId: Id<"workspaces">;
	teamId?: Id<"teams">;
	version: number;
	updatedAt: number;
	archivedAt?: number;
	deletedAt?: number;
}

/** Map a normalized document/plan to the full `documents` column set. */
export function documentColumns(n: NormalizedDocument, base: DocBase) {
	const f = n.fields;
	const isPlan = f.type === "plan";
	return {
		workspaceId: base.workspaceId,
		teamId: base.teamId,
		ulid: f.id,
		docType: f.type,
		title: f.title,
		project: f.project ?? undefined,
		planStatus: isPlan ? (f.planStatus ?? "draft") : undefined,
		parent: isPlan ? (f.parent ?? undefined) : undefined,
		supersedes: isPlan ? (f.supersedes ?? undefined) : undefined,
		executedVersion: isPlan ? (f.executedVersion ?? undefined) : undefined,
		content: n.content,
		body: n.body,
		contentHash: n.contentHash,
		version: base.version,
		updatedAt: base.updatedAt,
		archivedAt: base.archivedAt,
		deletedAt: base.deletedAt,
	};
}

/** The outbound typed edges implied by an issue's relation fields. */
export function issueEdges(
	n: NormalizedIssue,
): { type: string; target: string }[] {
	const f = n.fields;
	const edges: { type: string; target: string }[] = [];
	if (f.parent) edges.push({ type: "parent", target: f.parent });
	if (f.project) edges.push({ type: "project", target: f.project });
	if (f.milestone) edges.push({ type: "milestone", target: f.milestone });
	if (f.plan) edges.push({ type: "plan", target: f.plan });
	for (const b of f.blockedBy ?? [])
		edges.push({ type: "blocked_by", target: b });
	return edges;
}

/**
 * Replace all outbound edges for `sourceUlid` with `edges`. A source fully owns
 * its outbound edges (they mirror its frontmatter), so we delete-then-insert.
 */
export async function syncEdges(
	ctx: MutationCtx,
	workspaceId: Id<"workspaces">,
	sourceUlid: string,
	edges: { type: string; target: string }[],
): Promise<void> {
	const existing = await ctx.db
		.query("edges")
		.withIndex("by_source", (q) =>
			q.eq("workspaceId", workspaceId).eq("sourceUlid", sourceUlid),
		)
		.collect();
	for (const e of existing) await ctx.db.delete(e._id);
	for (const e of edges) {
		if (!e.target) continue;
		await ctx.db.insert("edges", {
			workspaceId,
			type: e.type,
			sourceUlid,
			targetUlid: e.target,
		});
	}
}
