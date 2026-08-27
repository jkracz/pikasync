import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import {
	loadContext,
	logEvent,
	provisionContext,
	requireTeamMembership,
} from "./lib/auth";
import {
	buildDocument,
	extraFields,
	generateUlid,
	splitRaw,
} from "./lib/format";
import { clearable, documentColumns } from "./lib/write";
import { docTypeValidator, planStatusValidator } from "./schema";

const documentSummary = v.object({
	id: v.id("documents"),
	ulid: v.string(),
	docType: docTypeValidator,
	title: v.string(),
	planStatus: v.optional(planStatusValidator),
	updatedAt: v.number(),
	archived: v.boolean(),
});

const documentDetail = v.object({
	id: v.id("documents"),
	ulid: v.string(),
	docType: docTypeValidator,
	title: v.string(),
	teamId: v.optional(v.id("teams")),
	project: v.optional(v.string()),
	planStatus: v.optional(planStatusValidator),
	parent: v.optional(v.string()),
	supersedes: v.optional(v.string()),
	executedVersion: v.optional(v.number()),
	body: v.string(),
	content: v.string(),
	version: v.number(),
	createdAt: v.number(),
	updatedAt: v.number(),
	archived: v.boolean(),
});

function toDetail(d: Doc<"documents">) {
	return {
		id: d._id,
		ulid: d.ulid,
		docType: d.docType,
		title: d.title,
		teamId: d.teamId,
		project: d.project,
		planStatus: d.planStatus,
		parent: d.parent,
		supersedes: d.supersedes,
		executedVersion: d.executedVersion,
		body: d.body,
		content: d.content,
		version: d.version,
		createdAt: d._creationTime,
		updatedAt: d.updatedAt,
		archived: d.archivedAt !== undefined,
	};
}

export const create = mutation({
	args: {
		docType: docTypeValidator,
		title: v.string(),
		teamId: v.optional(v.id("teams")),
		project: v.optional(v.string()),
		body: v.optional(v.string()),
		// plan-only
		planStatus: v.optional(planStatusValidator),
		parent: v.optional(v.string()),
		supersedes: v.optional(v.string()),
		executedVersion: v.optional(v.number()),
	},
	returns: v.object({ id: v.id("documents"), ulid: v.string() }),
	handler: async (ctx, args) => {
		const { user, workspace } = await provisionContext(ctx);
		let teamKey: string | undefined;
		if (args.teamId) {
			const { team } = await requireTeamMembership(
				ctx,
				args.teamId,
				workspace._id,
				user._id,
			);
			teamKey = team.key;
		}
		const ulid = generateUlid();
		const now = Date.now();
		const iso = new Date(now).toISOString();
		const base = {
			id: ulid,
			title: args.title,
			team: teamKey,
			project: args.project,
			created: iso,
			updated: iso,
		};
		const input =
			args.docType === "plan"
				? {
						...base,
						type: "plan" as const,
						planStatus: args.planStatus ?? "draft",
						parent: args.parent,
						supersedes: args.supersedes,
						executedVersion: args.executedVersion,
					}
				: { ...base, type: "doc" as const };
		const n = buildDocument(input, args.body ?? "");
		const id = await ctx.db.insert(
			"documents",
			documentColumns(n, {
				workspaceId: workspace._id,
				teamId: args.teamId,
				version: 1,
				updatedAt: now,
			}),
		);
		await logEvent(ctx, {
			workspaceId: workspace._id,
			entityUlid: ulid,
			entityType: "document",
			kind: "created",
			actorId: user._id,
		});
		return { id, ulid };
	},
});

export const get = query({
	args: { documentId: v.id("documents") },
	returns: v.union(v.null(), documentDetail),
	handler: async (ctx, args) => {
		const { user, workspace } = await loadContext(ctx);
		const doc = await ctx.db.get(args.documentId);
		if (
			!doc ||
			doc.workspaceId !== workspace._id ||
			doc.deletedAt !== undefined
		) {
			return null;
		}
		// Team-scoped docs are only visible to team members (team-less docs are
		// workspace-visible). Mirror the issues read-path guard.
		if (doc.teamId) {
			try {
				await requireTeamMembership(ctx, doc.teamId, workspace._id, user._id);
			} catch {
				return null;
			}
		}
		return toDetail(doc);
	},
});

export const list = query({
	args: {
		docType: v.optional(docTypeValidator),
		includeArchived: v.optional(v.boolean()),
	},
	returns: v.array(documentSummary),
	handler: async (ctx, args) => {
		const { user, workspace } = await loadContext(ctx);
		// The set of teams the caller belongs to (team-less docs are visible to all).
		const memberships = await ctx.db
			.query("teamMembers")
			.withIndex("by_user", (q) => q.eq("userId", user._id))
			.collect();
		const teamIds = new Set(
			memberships
				.filter((m) => m.workspaceId === workspace._id)
				.map((m) => m.teamId),
		);
		const docType = args.docType;
		const base = docType
			? ctx.db
					.query("documents")
					.withIndex("by_workspace_type", (q) =>
						q.eq("workspaceId", workspace._id).eq("docType", docType),
					)
			: ctx.db
					.query("documents")
					.withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id));
		// Filter tombstones (and archived) at the index level so they don't
		// consume the take() budget and silently drop live rows.
		const filtered = args.includeArchived
			? base.filter((q) => q.eq(q.field("deletedAt"), undefined))
			: base.filter((q) =>
					q.and(
						q.eq(q.field("deletedAt"), undefined),
						q.eq(q.field("archivedAt"), undefined),
					),
				);
		const rows = await filtered.order("desc").take(500);
		return rows
			.filter((r) => r.teamId === undefined || teamIds.has(r.teamId))
			.map((r) => ({
				id: r._id,
				ulid: r.ulid,
				docType: r.docType,
				title: r.title,
				planStatus: r.planStatus,
				updatedAt: r.updatedAt,
				archived: r.archivedAt !== undefined,
			}));
	},
});

export const update = mutation({
	args: {
		documentId: v.id("documents"),
		expectedVersion: v.optional(v.number()),
		title: v.optional(v.string()),
		project: v.optional(v.union(v.string(), v.null())),
		body: v.optional(v.string()),
		planStatus: v.optional(planStatusValidator),
		parent: v.optional(v.union(v.string(), v.null())),
		supersedes: v.optional(v.union(v.string(), v.null())),
		executedVersion: v.optional(v.union(v.number(), v.null())),
	},
	returns: v.object({ version: v.number() }),
	handler: async (ctx, args) => {
		const { user, workspace } = await provisionContext(ctx);
		const doc = await ctx.db.get(args.documentId);
		if (
			!doc ||
			doc.workspaceId !== workspace._id ||
			doc.deletedAt !== undefined
		) {
			throw new Error("Document not found");
		}
		if (doc.teamId) {
			await requireTeamMembership(ctx, doc.teamId, workspace._id, user._id);
		}
		if (
			args.expectedVersion !== undefined &&
			args.expectedVersion !== doc.version
		) {
			throw new Error(
				`Version conflict: expected ${args.expectedVersion}, current ${doc.version}`,
			);
		}
		const teamKey = doc.teamId
			? ((await ctx.db.get(doc.teamId))?.key ?? undefined)
			: undefined;
		const now = Date.now();
		const base = {
			id: doc.ulid,
			title: args.title ?? doc.title,
			team: teamKey,
			project: clearable(args.project, doc.project),
			// Reuse the original `created` so it stays byte-stable across edits.
			created:
				(splitRaw(doc.content).frontmatter.created as string | undefined) ??
				new Date(doc._creationTime).toISOString(),
			updated: new Date(now).toISOString(),
		};
		const input =
			doc.docType === "plan"
				? {
						...base,
						type: "plan" as const,
						planStatus: args.planStatus ?? doc.planStatus ?? "draft",
						parent: clearable(args.parent, doc.parent),
						supersedes: clearable(args.supersedes, doc.supersedes),
						executedVersion: clearable(
							args.executedVersion,
							doc.executedVersion,
						),
					}
				: { ...base, type: "doc" as const };
		const n = buildDocument(
			input,
			args.body === undefined ? doc.body : args.body,
			extraFields(doc.content),
		);
		const version = doc.version + 1;
		await ctx.db.replace(
			doc._id,
			documentColumns(n, {
				workspaceId: workspace._id,
				teamId: doc.teamId,
				version,
				updatedAt: now,
				archivedAt: doc.archivedAt,
				deletedAt: doc.deletedAt,
			}),
		);
		await logEvent(ctx, {
			workspaceId: workspace._id,
			entityUlid: doc.ulid,
			entityType: "document",
			kind: "updated",
			actorId: user._id,
		});
		return { version };
	},
});

export const archive = mutation({
	args: { documentId: v.id("documents") },
	returns: v.null(),
	handler: async (ctx, args) => {
		const { user, workspace } = await provisionContext(ctx);
		const doc = await ctx.db.get(args.documentId);
		if (
			!doc ||
			doc.workspaceId !== workspace._id ||
			doc.deletedAt !== undefined
		) {
			throw new Error("Document not found");
		}
		if (doc.teamId) {
			await requireTeamMembership(ctx, doc.teamId, workspace._id, user._id);
		}
		const now = Date.now();
		await ctx.db.patch(doc._id, {
			archivedAt: now,
			updatedAt: now,
			version: doc.version + 1,
		});
		await logEvent(ctx, {
			workspaceId: workspace._id,
			entityUlid: doc.ulid,
			entityType: "document",
			kind: "archived",
			actorId: user._id,
		});
		return null;
	},
});

export const remove = mutation({
	args: { documentId: v.id("documents") },
	returns: v.null(),
	handler: async (ctx, args) => {
		const { user, workspace } = await provisionContext(ctx);
		const doc = await ctx.db.get(args.documentId);
		if (!doc || doc.workspaceId !== workspace._id) {
			throw new Error("Document not found");
		}
		if (doc.teamId) {
			await requireTeamMembership(ctx, doc.teamId, workspace._id, user._id);
		}
		const now = Date.now();
		await ctx.db.patch(doc._id, {
			deletedAt: now,
			updatedAt: now,
			version: doc.version + 1,
		});
		await logEvent(ctx, {
			workspaceId: workspace._id,
			entityUlid: doc.ulid,
			entityType: "document",
			kind: "deleted",
			actorId: user._id,
		});
		return null;
	},
});
