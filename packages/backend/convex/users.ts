import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
	activeOrgId,
	ensureUser,
	ensureWorkspace,
	ensureWorkspaceMember,
	loadIdentity,
	orgRole,
} from "./lib/auth";
import { roleValidator } from "./schema";

const userDto = v.object({
	id: v.id("users"),
	name: v.optional(v.string()),
	email: v.optional(v.string()),
});

/**
 * Provision the current user (and, if an org is active, their workspace +
 * membership) from the verified Clerk identity. Idempotent; call once after
 * sign-in. Returns `needs_org` when the user has no active Clerk organization.
 */
export const bootstrap = mutation({
	args: {},
	returns: v.object({
		status: v.union(v.literal("ok"), v.literal("needs_org")),
		user: userDto,
		workspace: v.optional(
			v.object({
				id: v.id("workspaces"),
				name: v.string(),
				slug: v.string(),
				role: roleValidator,
			}),
		),
	}),
	handler: async (ctx) => {
		const identity = await loadIdentity(ctx);
		const user = await ensureUser(ctx, identity);
		const orgId = activeOrgId(identity);
		if (!orgId) {
			return {
				status: "needs_org" as const,
				user: { id: user._id, name: user.name, email: user.email },
			};
		}
		const workspace = await ensureWorkspace(ctx, identity);
		const role = orgRole(identity);
		await ensureWorkspaceMember(ctx, workspace._id, user._id, role);
		return {
			status: "ok" as const,
			user: { id: user._id, name: user.name, email: user.email },
			workspace: {
				id: workspace._id,
				name: workspace.name,
				slug: workspace.slug,
				role,
			},
		};
	},
});

/** Reactive read of the current user + active workspace. Null when signed out. */
export const current = query({
	args: {},
	returns: v.union(
		v.null(),
		v.object({
			user: userDto,
			workspace: v.union(
				v.null(),
				v.object({
					id: v.id("workspaces"),
					name: v.string(),
					slug: v.string(),
				}),
			),
			role: roleValidator,
		}),
	),
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		const user = await ctx.db
			.query("users")
			.withIndex("by_clerk", (q) => q.eq("clerkUserId", identity.subject))
			.unique();
		if (!user) return null;
		const role = orgRole(identity);
		const orgId = activeOrgId(identity);
		const workspace = orgId
			? await ctx.db
					.query("workspaces")
					.withIndex("by_clerkOrg", (q) => q.eq("clerkOrgId", orgId))
					.unique()
			: null;
		return {
			user: { id: user._id, name: user.name, email: user.email },
			workspace: workspace
				? { id: workspace._id, name: workspace.name, slug: workspace.slug }
				: null,
			role,
		};
	},
});
