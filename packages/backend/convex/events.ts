import { v } from "convex/values";
import { loadContext, requireTeamMembership } from "./lib/auth";
import { query } from "./_generated/server";
import { actorTypeValidator } from "./schema";

/** Recent activity for an entity (issue/doc). Workspace-scoped read. */
export const listForEntity = query({
	args: { entityUlid: v.string() },
	returns: v.array(
		v.object({
			id: v.id("events"),
			kind: v.string(),
			entityType: v.string(),
			actorType: actorTypeValidator,
			actorId: v.optional(v.string()),
			creationTime: v.number(),
		}),
	),
	handler: async (ctx, args) => {
		const { user, workspace } = await loadContext(ctx);
		// Enforce the team boundary on the underlying entity before exposing its
		// activity (mirrors the issues/documents read guards). team-less docs are
		// workspace-visible; an unknown entity simply yields no events.
		const issue = await ctx.db
			.query("issues")
			.withIndex("by_workspace_ulid", (q) =>
				q.eq("workspaceId", workspace._id).eq("ulid", args.entityUlid),
			)
			.unique();
		if (issue) {
			await requireTeamMembership(ctx, issue.teamId, workspace._id, user._id);
		} else {
			const doc = await ctx.db
				.query("documents")
				.withIndex("by_workspace_ulid", (q) =>
					q.eq("workspaceId", workspace._id).eq("ulid", args.entityUlid),
				)
				.unique();
			if (doc?.teamId) {
				await requireTeamMembership(ctx, doc.teamId, workspace._id, user._id);
			}
		}
		const events = await ctx.db
			.query("events")
			.withIndex("by_entity", (q) =>
				q.eq("workspaceId", workspace._id).eq("entityUlid", args.entityUlid),
			)
			.order("desc")
			.take(50);
		return events.map((e) => ({
			id: e._id,
			kind: e.kind,
			entityType: e.entityType,
			actorType: e.actorType,
			actorId: e.actorId,
			creationTime: e._creationTime,
		}));
	},
});
