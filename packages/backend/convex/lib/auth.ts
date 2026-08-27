/**
 * Auth + authorization helpers. Every public function that touches workspace or
 * team data MUST go through these — the server is the only place membership is
 * enforced. The client's claimed scope is never trusted.
 */
import type { UserIdentity } from "convex/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type AnyCtx = QueryCtx | MutationCtx;

export type Role = "admin" | "member";

interface OrgClaims {
	org_id?: string;
	org_slug?: string;
	org_role?: string;
}

/** Custom claims added to the Clerk "convex" JWT template arrive on the identity. */
function orgClaims(identity: UserIdentity): OrgClaims {
	return identity as unknown as OrgClaims;
}

function roleFromOrgRole(orgRole: string | undefined): Role {
	return orgRole?.includes("admin") ? "admin" : "member";
}

export async function loadIdentity(ctx: AnyCtx): Promise<UserIdentity> {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) throw new Error("Not authenticated");
	return identity;
}

export interface AppContext {
	identity: UserIdentity;
	user: Doc<"users">;
	workspace: Doc<"workspaces">;
	role: Role;
}

/**
 * Read-only context resolution for queries. Throws if the caller hasn't been
 * provisioned yet (the client should call `users.bootstrap` once after sign-in)
 * or has no active organization selected.
 */
export async function loadContext(ctx: AnyCtx): Promise<AppContext> {
	const identity = await loadIdentity(ctx);
	const user = await ctx.db
		.query("users")
		.withIndex("by_clerk", (q) => q.eq("clerkUserId", identity.subject))
		.unique();
	if (!user) throw new Error("Not provisioned — call users.bootstrap");
	const orgId = orgClaims(identity).org_id;
	if (!orgId) throw new Error("No active organization selected");
	const workspace = await ctx.db
		.query("workspaces")
		.withIndex("by_clerkOrg", (q) => q.eq("clerkOrgId", orgId))
		.unique();
	if (!workspace)
		throw new Error("Workspace not provisioned — call users.bootstrap");
	return {
		identity,
		user,
		workspace,
		role: roleFromOrgRole(orgClaims(identity).org_role),
	};
}

export async function ensureUser(
	ctx: MutationCtx,
	identity: UserIdentity,
): Promise<Doc<"users">> {
	const existing = await ctx.db
		.query("users")
		.withIndex("by_clerk", (q) => q.eq("clerkUserId", identity.subject))
		.unique();
	if (existing) {
		if (existing.email !== identity.email || existing.name !== identity.name) {
			await ctx.db.patch(existing._id, {
				email: identity.email ?? undefined,
				name: identity.name ?? undefined,
			});
		}
		return (await ctx.db.get(existing._id)) as Doc<"users">;
	}
	const id = await ctx.db.insert("users", {
		clerkUserId: identity.subject,
		email: identity.email ?? undefined,
		name: identity.name ?? undefined,
		imageUrl: identity.pictureUrl ?? undefined,
	});
	return (await ctx.db.get(id)) as Doc<"users">;
}

export async function ensureWorkspace(
	ctx: MutationCtx,
	identity: UserIdentity,
): Promise<Doc<"workspaces">> {
	const claims = orgClaims(identity);
	if (!claims.org_id) throw new Error("No active organization selected");
	const existing = await ctx.db
		.query("workspaces")
		.withIndex("by_clerkOrg", (q) =>
			q.eq("clerkOrgId", claims.org_id as string),
		)
		.unique();
	if (existing) return existing;
	const id = await ctx.db.insert("workspaces", {
		clerkOrgId: claims.org_id,
		name: claims.org_slug ?? "Workspace",
		slug: claims.org_slug ?? claims.org_id,
	});
	return (await ctx.db.get(id)) as Doc<"workspaces">;
}

export async function ensureWorkspaceMember(
	ctx: MutationCtx,
	workspaceId: Id<"workspaces">,
	userId: Id<"users">,
	role: Role,
): Promise<void> {
	const existing = await ctx.db
		.query("workspaceMembers")
		.withIndex("by_workspace_user", (q) =>
			q.eq("workspaceId", workspaceId).eq("userId", userId),
		)
		.unique();
	if (existing) {
		if (existing.role !== role) await ctx.db.patch(existing._id, { role });
		return;
	}
	await ctx.db.insert("workspaceMembers", { workspaceId, userId, role });
}

/** Provision (user + workspace + membership) for mutations. Requires an active org. */
export async function provisionContext(ctx: MutationCtx): Promise<AppContext> {
	const identity = await loadIdentity(ctx);
	const user = await ensureUser(ctx, identity);
	const workspace = await ensureWorkspace(ctx, identity);
	const role = roleFromOrgRole(orgClaims(identity).org_role);
	await ensureWorkspaceMember(ctx, workspace._id, user._id, role);
	return { identity, user, workspace, role };
}

/** Get the org id from claims without throwing (for graceful "needs org" UX). */
export function activeOrgId(identity: UserIdentity): string | undefined {
	return orgClaims(identity).org_id;
}

export function orgRole(identity: UserIdentity): Role {
	return roleFromOrgRole(orgClaims(identity).org_role);
}

/**
 * The core security gate: the caller must be a member of `teamId`, and the team
 * must belong to `workspaceId`. Returns the membership (for role checks).
 */
export async function requireTeamMembership(
	ctx: AnyCtx,
	teamId: Id<"teams">,
	workspaceId: Id<"workspaces">,
	userId: Id<"users">,
): Promise<{ team: Doc<"teams">; membership: Doc<"teamMembers"> }> {
	const team = await ctx.db.get(teamId);
	if (!team || team.workspaceId !== workspaceId) {
		throw new Error("Team not found in this workspace");
	}
	const membership = await ctx.db
		.query("teamMembers")
		.withIndex("by_team_user", (q) =>
			q.eq("teamId", teamId).eq("userId", userId),
		)
		.unique();
	if (!membership) throw new Error("Unauthorized: not a member of this team");
	return { team, membership };
}

export async function requireTeamAdmin(
	ctx: AnyCtx,
	teamId: Id<"teams">,
	workspaceId: Id<"workspaces">,
	userId: Id<"users">,
): Promise<{ team: Doc<"teams">; membership: Doc<"teamMembers"> }> {
	const result = await requireTeamMembership(ctx, teamId, workspaceId, userId);
	if (result.membership.role !== "admin") {
		throw new Error("Unauthorized: team admin required");
	}
	return result;
}

export type ActorType = "human" | "agent" | "system";

/** Append to the activity log. Defaults to a human actor (the web user). */
export async function logEvent(
	ctx: MutationCtx,
	args: {
		workspaceId: Id<"workspaces">;
		entityUlid: string;
		entityType: string;
		kind: string;
		actorType?: ActorType;
		actorId?: string;
		data?: unknown;
	},
): Promise<void> {
	await ctx.db.insert("events", {
		workspaceId: args.workspaceId,
		entityUlid: args.entityUlid,
		entityType: args.entityType,
		kind: args.kind,
		actorType: args.actorType ?? "human",
		actorId: args.actorId,
		data: args.data,
	});
}
