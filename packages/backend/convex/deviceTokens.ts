import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, mutation, query } from "./_generated/server";
import {
	loadContext,
	logEvent,
	provisionContext,
	requireTeamMembership,
} from "./lib/auth";
import { sha256Hex } from "./lib/token";

function base64url(bytes: Uint8Array): string {
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Mint a per-device token for the daemon/CLI. The plaintext is returned ONCE and
 * never stored — only its SHA-256 hash is persisted. Runs as an action because
 * it needs Web Crypto.
 */
export const mint = action({
	args: { name: v.string(), scopeTeamIds: v.optional(v.array(v.id("teams"))) },
	returns: v.object({
		id: v.id("deviceTokens"),
		token: v.string(),
		prefix: v.string(),
	}),
	handler: async (ctx, args) => {
		const bytes = new Uint8Array(32);
		crypto.getRandomValues(bytes);
		const token = `pk_${base64url(bytes)}`;
		const prefix = token.slice(0, 11);
		const tokenHash = await sha256Hex(token);
		const id: import("./_generated/dataModel").Id<"deviceTokens"> =
			await ctx.runMutation(internal.deviceTokens.store, {
				name: args.name,
				scopeTeamIds: args.scopeTeamIds ?? [],
				tokenHash,
				prefix,
			});
		return { id, token, prefix };
	},
});

export const store = internalMutation({
	args: {
		name: v.string(),
		scopeTeamIds: v.array(v.id("teams")),
		tokenHash: v.string(),
		prefix: v.string(),
	},
	returns: v.id("deviceTokens"),
	handler: async (ctx, args) => {
		const { user, workspace } = await provisionContext(ctx);
		// Every scoped team must be one the caller actually belongs to.
		for (const teamId of args.scopeTeamIds) {
			await requireTeamMembership(ctx, teamId, workspace._id, user._id);
		}
		const id = await ctx.db.insert("deviceTokens", {
			workspaceId: workspace._id,
			userId: user._id,
			name: args.name,
			tokenHash: args.tokenHash,
			prefix: args.prefix,
			scopeTeamIds: args.scopeTeamIds,
			createdAt: Date.now(),
		});
		await logEvent(ctx, {
			workspaceId: workspace._id,
			entityUlid: id,
			entityType: "deviceToken",
			kind: "created",
			actorId: user._id,
		});
		return id;
	},
});

export const list = query({
	args: {},
	returns: v.array(
		v.object({
			id: v.id("deviceTokens"),
			name: v.string(),
			prefix: v.string(),
			scopeTeamIds: v.array(v.id("teams")),
			createdAt: v.number(),
			lastUsedAt: v.optional(v.number()),
			revoked: v.boolean(),
		}),
	),
	handler: async (ctx) => {
		const { user, workspace } = await loadContext(ctx);
		const tokens = await ctx.db
			.query("deviceTokens")
			.withIndex("by_user", (q) => q.eq("userId", user._id))
			.collect();
		return tokens
			.filter((t) => t.workspaceId === workspace._id)
			.map((t) => ({
				id: t._id,
				name: t.name,
				prefix: t.prefix,
				scopeTeamIds: t.scopeTeamIds,
				createdAt: t.createdAt,
				lastUsedAt: t.lastUsedAt,
				revoked: t.revokedAt !== undefined,
			}));
	},
});

export const revoke = mutation({
	args: { tokenId: v.id("deviceTokens") },
	returns: v.null(),
	handler: async (ctx, args) => {
		const { user, workspace } = await provisionContext(ctx);
		const token = await ctx.db.get(args.tokenId);
		if (
			!token ||
			token.workspaceId !== workspace._id ||
			token.userId !== user._id
		) {
			throw new Error("Token not found");
		}
		await ctx.db.patch(args.tokenId, { revokedAt: Date.now() });
		return null;
	},
});
