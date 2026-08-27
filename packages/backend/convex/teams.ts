import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
	loadContext,
	logEvent,
	provisionContext,
	requireTeamAdmin,
	requireTeamMembership,
} from "./lib/auth";
import { mutation, query } from "./_generated/server";

const teamDto = v.object({
	id: v.id("teams"),
	key: v.string(),
	name: v.string(),
});

/** Create a team. The creator becomes its first admin member. */
export const create = mutation({
	args: { key: v.string(), name: v.string() },
	returns: teamDto,
	handler: async (ctx, args) => {
		const { user, workspace } = await provisionContext(ctx);
		const key = args.key.trim().toUpperCase();
		if (!key) throw new Error("Team key is required");
		if (!/^[A-Z][A-Z0-9]{0,9}$/.test(key)) {
			throw new Error("Team key must be 1-10 uppercase letters/digits");
		}
		const existing = await ctx.db
			.query("teams")
			.withIndex("by_workspace_key", (q) =>
				q.eq("workspaceId", workspace._id).eq("key", key),
			)
			.unique();
		if (existing) throw new Error(`Team key ${key} already exists`);
		const name = args.name.trim() || key;
		const teamId = await ctx.db.insert("teams", {
			workspaceId: workspace._id,
			key,
			name,
			nextIssueNumber: 1,
		});
		await ctx.db.insert("teamMembers", {
			teamId,
			workspaceId: workspace._id,
			userId: user._id,
			role: "admin",
		});
		await logEvent(ctx, {
			workspaceId: workspace._id,
			entityUlid: teamId,
			entityType: "team",
			kind: "created",
			actorId: user._id,
		});
		return { id: teamId, key, name };
	},
});

/** Teams in the active workspace that the current user is a member of. */
export const list = query({
	args: {},
	returns: v.array(teamDto),
	handler: async (ctx) => {
		const { user, workspace } = await loadContext(ctx);
		const memberships = await ctx.db
			.query("teamMembers")
			.withIndex("by_user", (q) => q.eq("userId", user._id))
			.collect();
		const teams: Array<{ id: Id<"teams">; key: string; name: string }> = [];
		for (const m of memberships) {
			if (m.workspaceId !== workspace._id) continue;
			const team = await ctx.db.get(m.teamId);
			if (team) teams.push({ id: team._id, key: team.key, name: team.name });
		}
		return teams;
	},
});

export const get = query({
	args: { teamId: v.id("teams") },
	returns: teamDto,
	handler: async (ctx, args) => {
		const { user, workspace } = await loadContext(ctx);
		const { team } = await requireTeamMembership(
			ctx,
			args.teamId,
			workspace._id,
			user._id,
		);
		return { id: team._id, key: team.key, name: team.name };
	},
});

/** Add a user (by Clerk subject) to a team. Admin-gated. */
export const addMember = mutation({
	args: {
		teamId: v.id("teams"),
		clerkUserId: v.string(),
		role: v.optional(v.union(v.literal("admin"), v.literal("member"))),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const { user, workspace } = await provisionContext(ctx);
		const { team } = await requireTeamAdmin(
			ctx,
			args.teamId,
			workspace._id,
			user._id,
		);
		const target = await ctx.db
			.query("users")
			.withIndex("by_clerk", (q) => q.eq("clerkUserId", args.clerkUserId))
			.unique();
		if (!target) throw new Error("User not found (must have signed in once)");
		const existing = await ctx.db
			.query("teamMembers")
			.withIndex("by_team_user", (q) =>
				q.eq("teamId", team._id).eq("userId", target._id),
			)
			.unique();
		if (existing) return null;
		await ctx.db.insert("teamMembers", {
			teamId: team._id,
			workspaceId: workspace._id,
			userId: target._id,
			role: args.role ?? "member",
		});
		return null;
	},
});
