import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import {
	loadContext,
	logEvent,
	provisionContext,
	requireTeamMembership,
} from "./lib/auth";
import { buildIssue, extraFields, generateUlid, splitRaw } from "./lib/format";
import { clearable, issueColumns, issueEdges, syncEdges } from "./lib/write";
import { issueStatusValidator, priorityValidator } from "./schema";

const issueSummary = v.object({
	id: v.id("issues"),
	ulid: v.string(),
	identifier: v.string(),
	title: v.string(),
	status: issueStatusValidator,
	priority: priorityValidator,
	assignee: v.optional(v.string()),
	labels: v.array(v.string()),
	updatedAt: v.number(),
	archived: v.boolean(),
});

const issueDetail = v.object({
	id: v.id("issues"),
	teamId: v.id("teams"),
	ulid: v.string(),
	identifier: v.string(),
	number: v.number(),
	title: v.string(),
	status: issueStatusValidator,
	priority: priorityValidator,
	assignee: v.optional(v.string()),
	estimate: v.optional(v.number()),
	labels: v.array(v.string()),
	due: v.optional(v.string()),
	project: v.optional(v.string()),
	milestone: v.optional(v.string()),
	plan: v.optional(v.string()),
	planSection: v.optional(v.string()),
	parent: v.optional(v.string()),
	blockedBy: v.array(v.string()),
	body: v.string(),
	content: v.string(),
	version: v.number(),
	createdAt: v.number(),
	updatedAt: v.number(),
	archived: v.boolean(),
});

function toDetail(d: Doc<"issues">) {
	return {
		id: d._id,
		teamId: d.teamId,
		ulid: d.ulid,
		identifier: d.identifier,
		number: d.number,
		title: d.title,
		status: d.status,
		priority: d.priority,
		assignee: d.assignee,
		estimate: d.estimate,
		labels: d.labels,
		due: d.due,
		project: d.project,
		milestone: d.milestone,
		plan: d.plan,
		planSection: d.planSection,
		parent: d.parent,
		blockedBy: d.blockedBy,
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
		teamId: v.id("teams"),
		title: v.string(),
		status: v.optional(issueStatusValidator),
		priority: v.optional(priorityValidator),
		assignee: v.optional(v.string()),
		estimate: v.optional(v.number()),
		labels: v.optional(v.array(v.string())),
		due: v.optional(v.string()),
		project: v.optional(v.string()),
		milestone: v.optional(v.string()),
		plan: v.optional(v.string()),
		planSection: v.optional(v.string()),
		parent: v.optional(v.string()),
		blockedBy: v.optional(v.array(v.string())),
		body: v.optional(v.string()),
	},
	returns: v.object({
		id: v.id("issues"),
		ulid: v.string(),
		identifier: v.string(),
	}),
	handler: async (ctx, args) => {
		const { user, workspace } = await provisionContext(ctx);
		const { team } = await requireTeamMembership(
			ctx,
			args.teamId,
			workspace._id,
			user._id,
		);
		const number = team.nextIssueNumber;
		const identifier = `${team.key}-${number}`;
		await ctx.db.patch(team._id, { nextIssueNumber: number + 1 });

		const ulid = generateUlid();
		const now = Date.now();
		const iso = new Date(now).toISOString();
		const n = buildIssue(
			{
				id: ulid,
				identifier,
				type: "issue",
				title: args.title,
				status: args.status ?? "backlog",
				team: team.key,
				assignee: args.assignee,
				priority: args.priority ?? "none",
				estimate: args.estimate,
				labels: args.labels ?? [],
				project: args.project,
				milestone: args.milestone,
				plan: args.plan,
				planSection: args.planSection,
				parent: args.parent,
				blockedBy: args.blockedBy ?? [],
				due: args.due,
				created: iso,
				updated: iso,
			},
			args.body ?? "",
		);
		const id = await ctx.db.insert(
			"issues",
			issueColumns(n, {
				workspaceId: workspace._id,
				teamId: team._id,
				identifier,
				number,
				version: 1,
				updatedAt: now,
			}),
		);
		await syncEdges(ctx, workspace._id, ulid, issueEdges(n));
		await logEvent(ctx, {
			workspaceId: workspace._id,
			entityUlid: ulid,
			entityType: "issue",
			kind: "created",
			actorId: user._id,
		});
		return { id, ulid, identifier };
	},
});

export const get = query({
	args: { issueId: v.id("issues") },
	returns: v.union(v.null(), issueDetail),
	handler: async (ctx, args) => {
		const { user, workspace } = await loadContext(ctx);
		const issue = await ctx.db.get(args.issueId);
		if (
			!issue ||
			issue.workspaceId !== workspace._id ||
			issue.deletedAt !== undefined
		) {
			return null;
		}
		await requireTeamMembership(ctx, issue.teamId, workspace._id, user._id);
		return toDetail(issue);
	},
});

export const getByUlid = query({
	args: { ulid: v.string() },
	returns: v.union(v.null(), issueDetail),
	handler: async (ctx, args) => {
		const { user, workspace } = await loadContext(ctx);
		const issue = await ctx.db
			.query("issues")
			.withIndex("by_workspace_ulid", (q) =>
				q.eq("workspaceId", workspace._id).eq("ulid", args.ulid),
			)
			.unique();
		if (!issue || issue.deletedAt !== undefined) return null;
		await requireTeamMembership(ctx, issue.teamId, workspace._id, user._id);
		return toDetail(issue);
	},
});

export const list = query({
	args: {
		teamId: v.id("teams"),
		status: v.optional(issueStatusValidator),
		includeArchived: v.optional(v.boolean()),
	},
	returns: v.array(issueSummary),
	handler: async (ctx, args) => {
		const { user, workspace } = await loadContext(ctx);
		await requireTeamMembership(ctx, args.teamId, workspace._id, user._id);
		const status = args.status;
		const base = status
			? ctx.db
					.query("issues")
					.withIndex("by_team_status", (q) =>
						q.eq("teamId", args.teamId).eq("status", status),
					)
			: ctx.db
					.query("issues")
					.withIndex("by_team", (q) => q.eq("teamId", args.teamId));
		// Filter tombstones (and archived) at the index level so they don't
		// consume the take() budget and silently drop live rows below the window.
		const filtered = args.includeArchived
			? base.filter((q) => q.eq(q.field("deletedAt"), undefined))
			: base.filter((q) =>
					q.and(
						q.eq(q.field("deletedAt"), undefined),
						q.eq(q.field("archivedAt"), undefined),
					),
				);
		const rows = await filtered.order("desc").take(500);
		return rows.map((r) => ({
			id: r._id,
			ulid: r.ulid,
			identifier: r.identifier,
			title: r.title,
			status: r.status,
			priority: r.priority,
			assignee: r.assignee,
			labels: r.labels,
			updatedAt: r.updatedAt,
			archived: r.archivedAt !== undefined,
		}));
	},
});

export const update = mutation({
	args: {
		issueId: v.id("issues"),
		expectedVersion: v.optional(v.number()),
		title: v.optional(v.string()),
		status: v.optional(issueStatusValidator),
		priority: v.optional(priorityValidator),
		assignee: v.optional(v.union(v.string(), v.null())),
		estimate: v.optional(v.union(v.number(), v.null())),
		labels: v.optional(v.array(v.string())),
		due: v.optional(v.union(v.string(), v.null())),
		project: v.optional(v.union(v.string(), v.null())),
		milestone: v.optional(v.union(v.string(), v.null())),
		plan: v.optional(v.union(v.string(), v.null())),
		planSection: v.optional(v.union(v.string(), v.null())),
		parent: v.optional(v.union(v.string(), v.null())),
		blockedBy: v.optional(v.array(v.string())),
		body: v.optional(v.string()),
	},
	returns: v.object({ version: v.number() }),
	handler: async (ctx, args) => {
		const { user, workspace } = await provisionContext(ctx);
		const issue = await ctx.db.get(args.issueId);
		if (
			!issue ||
			issue.workspaceId !== workspace._id ||
			issue.deletedAt !== undefined
		) {
			throw new Error("Issue not found");
		}
		const { team } = await requireTeamMembership(
			ctx,
			issue.teamId,
			workspace._id,
			user._id,
		);
		if (
			args.expectedVersion !== undefined &&
			args.expectedVersion !== issue.version
		) {
			throw new Error(
				`Version conflict: expected ${args.expectedVersion}, current ${issue.version}`,
			);
		}
		const now = Date.now();
		const n = buildIssue(
			{
				id: issue.ulid,
				identifier: issue.identifier,
				type: "issue",
				title: args.title ?? issue.title,
				status: args.status ?? issue.status,
				team: team.key,
				assignee: clearable(args.assignee, issue.assignee),
				priority: args.priority ?? issue.priority,
				estimate: clearable(args.estimate, issue.estimate),
				labels: args.labels ?? issue.labels,
				project: clearable(args.project, issue.project),
				milestone: clearable(args.milestone, issue.milestone),
				plan: clearable(args.plan, issue.plan),
				planSection: clearable(args.planSection, issue.planSection),
				parent: clearable(args.parent, issue.parent),
				blockedBy: args.blockedBy ?? issue.blockedBy,
				due: clearable(args.due, issue.due),
				// Reuse the original `created` so it stays byte-stable across edits.
				created:
					(splitRaw(issue.content).frontmatter.created as string | undefined) ??
					new Date(issue._creationTime).toISOString(),
				updated: new Date(now).toISOString(),
			},
			args.body === undefined ? issue.body : args.body,
			// Preserve any custom frontmatter the file/agent added.
			extraFields(issue.content),
		);
		const version = issue.version + 1;
		await ctx.db.replace(
			issue._id,
			issueColumns(n, {
				workspaceId: workspace._id,
				teamId: issue.teamId,
				identifier: issue.identifier,
				number: issue.number,
				version,
				updatedAt: now,
				archivedAt: issue.archivedAt,
				deletedAt: issue.deletedAt,
			}),
		);
		await syncEdges(ctx, workspace._id, issue.ulid, issueEdges(n));
		await logEvent(ctx, {
			workspaceId: workspace._id,
			entityUlid: issue.ulid,
			entityType: "issue",
			kind: "updated",
			actorId: user._id,
		});
		return { version };
	},
});

export const archive = mutation({
	args: { issueId: v.id("issues") },
	returns: v.null(),
	handler: async (ctx, args) => {
		const { user, workspace } = await provisionContext(ctx);
		const issue = await ctx.db.get(args.issueId);
		if (
			!issue ||
			issue.workspaceId !== workspace._id ||
			issue.deletedAt !== undefined
		) {
			throw new Error("Issue not found");
		}
		await requireTeamMembership(ctx, issue.teamId, workspace._id, user._id);
		const now = Date.now();
		await ctx.db.patch(issue._id, {
			archivedAt: now,
			updatedAt: now,
			version: issue.version + 1,
		});
		await logEvent(ctx, {
			workspaceId: workspace._id,
			entityUlid: issue.ulid,
			entityType: "issue",
			kind: "archived",
			actorId: user._id,
		});
		return null;
	},
});

/** Soft-delete: tombstone the issue (kept for sync propagation) and drop edges. */
export const remove = mutation({
	args: { issueId: v.id("issues") },
	returns: v.null(),
	handler: async (ctx, args) => {
		const { user, workspace } = await provisionContext(ctx);
		const issue = await ctx.db.get(args.issueId);
		if (!issue || issue.workspaceId !== workspace._id) {
			throw new Error("Issue not found");
		}
		await requireTeamMembership(ctx, issue.teamId, workspace._id, user._id);
		const now = Date.now();
		await ctx.db.patch(issue._id, {
			deletedAt: now,
			updatedAt: now,
			version: issue.version + 1,
		});
		await syncEdges(ctx, workspace._id, issue.ulid, []);
		await logEvent(ctx, {
			workspaceId: workspace._id,
			entityUlid: issue.ulid,
			entityType: "issue",
			kind: "deleted",
			actorId: user._id,
		});
		return null;
	},
});
