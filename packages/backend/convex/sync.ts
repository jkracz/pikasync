/**
 * Daemon/CLI sync API. Authenticated by a device token (passed as an arg, hashed
 * and resolved server-side) rather than a Clerk JWT. The daemon calls the public
 * `action`s over Convex's HTTP API; the heavy lifting runs in internal functions
 * that reuse the SAME normalizer as the web mutations, so a file edit and a web
 * edit converge on byte-identical canonical content.
 */
import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
	type ActionCtx,
	action,
	internalMutation,
	internalQuery,
} from "./_generated/server";
import { logEvent } from "./lib/auth";
import { buildDocument, buildIssue, parseEntity, splitRaw } from "./lib/format";
import { closesIdentifier, extractIdentifiers, sha256Hex } from "./lib/token";
import {
	documentColumns,
	issueColumns,
	issueEdges,
	syncEdges,
} from "./lib/write";

const scopeValidator = {
	userId: v.id("users"),
	workspaceId: v.id("workspaces"),
	teamIds: v.array(v.id("teams")),
};

const entityValidator = v.object({
	ulid: v.string(),
	kind: v.union(v.literal("issue"), v.literal("document")),
	type: v.string(),
	identifier: v.optional(v.string()),
	teamKey: v.optional(v.string()),
	content: v.string(),
	version: v.number(),
	updatedAt: v.number(),
	deleted: v.boolean(),
});

const changesReturn = v.object({
	cursor: v.number(),
	entities: v.array(entityValidator),
});

const infoReturn = v.object({
	workspace: v.object({
		id: v.id("workspaces"),
		name: v.string(),
		slug: v.string(),
	}),
	teams: v.array(
		v.object({ id: v.id("teams"), key: v.string(), name: v.string() }),
	),
});

const upsertResult = v.object({
	status: v.string(), // created | applied | conflict | error
	ulid: v.string(),
	version: v.number(),
	identifier: v.optional(v.string()),
	content: v.string(),
	error: v.optional(v.string()),
});

const pushReturn = v.object({
	results: v.array(upsertResult),
	deleted: v.array(v.object({ ulid: v.string(), status: v.string() })),
});

const commitsReturn = v.object({
	linked: v.number(),
	closed: v.array(v.string()),
});

// ─────────────────────────────────────────────────────────────────────────────
// Internal: token resolution
// ─────────────────────────────────────────────────────────────────────────────

export const tokenScope = internalQuery({
	args: { tokenHash: v.string() },
	returns: v.union(v.null(), v.object(scopeValidator)),
	handler: async (ctx, { tokenHash }) => {
		const token = await ctx.db
			.query("deviceTokens")
			.withIndex("by_hash", (q) => q.eq("tokenHash", tokenHash))
			.unique();
		if (!token || token.revokedAt !== undefined) return null;
		let teamIds = token.scopeTeamIds;
		// Empty scope = all teams the token's user belongs to in this workspace.
		if (teamIds.length === 0) {
			const memberships = await ctx.db
				.query("teamMembers")
				.withIndex("by_user", (q) => q.eq("userId", token.userId))
				.collect();
			teamIds = memberships
				.filter((m) => m.workspaceId === token.workspaceId)
				.map((m) => m.teamId);
		}
		return {
			userId: token.userId,
			workspaceId: token.workspaceId,
			teamIds,
		};
	},
});

export const info = internalQuery({
	args: { workspaceId: v.id("workspaces"), teamIds: v.array(v.id("teams")) },
	returns: infoReturn,
	handler: async (ctx, { workspaceId, teamIds }) => {
		const ws = await ctx.db.get(workspaceId);
		if (!ws) throw new Error("Workspace not found");
		const teams: { id: Id<"teams">; key: string; name: string }[] = [];
		for (const id of teamIds) {
			const team = await ctx.db.get(id);
			if (team) teams.push({ id: team._id, key: team.key, name: team.name });
		}
		return {
			workspace: { id: ws._id, name: ws.name, slug: ws.slug },
			teams,
		};
	},
});

// ─────────────────────────────────────────────────────────────────────────────
// Internal: pull (cloud → daemon)
// ─────────────────────────────────────────────────────────────────────────────

export const changes = internalQuery({
	args: {
		workspaceId: v.id("workspaces"),
		teamIds: v.array(v.id("teams")),
		since: v.number(),
	},
	returns: changesReturn,
	handler: async (ctx, { workspaceId, teamIds, since }) => {
		// P1: bounded by data size (collect). A global change cursor/index is a
		// later optimization once workspaces grow large.
		const entities: Array<{
			ulid: string;
			kind: "issue" | "document";
			type: string;
			identifier?: string;
			teamKey?: string;
			content: string;
			version: number;
			updatedAt: number;
			deleted: boolean;
		}> = [];
		let cursor = since;
		const teamIdSet = new Set<Id<"teams">>(teamIds);

		for (const teamId of teamIds) {
			const team = await ctx.db.get(teamId);
			const teamKey = team?.key;
			const issues = await ctx.db
				.query("issues")
				.withIndex("by_team", (q) => q.eq("teamId", teamId))
				.collect();
			for (const i of issues) {
				if (i.updatedAt <= since) continue;
				cursor = Math.max(cursor, i.updatedAt);
				entities.push({
					ulid: i.ulid,
					kind: "issue",
					type: "issue",
					identifier: i.identifier,
					teamKey,
					content: i.content,
					version: i.version,
					updatedAt: i.updatedAt,
					deleted: i.deletedAt !== undefined,
				});
			}
		}

		const docs = await ctx.db
			.query("documents")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.collect();
		for (const d of docs) {
			if (d.updatedAt <= since) continue;
			if (d.teamId !== undefined && !teamIdSet.has(d.teamId)) continue;
			cursor = Math.max(cursor, d.updatedAt);
			const teamKey = d.teamId ? (await ctx.db.get(d.teamId))?.key : undefined;
			entities.push({
				ulid: d.ulid,
				kind: "document",
				type: d.docType,
				teamKey,
				content: d.content,
				version: d.version,
				updatedAt: d.updatedAt,
				deleted: d.deletedAt !== undefined,
			});
		}

		return { cursor, entities };
	},
});

// ─────────────────────────────────────────────────────────────────────────────
// Internal: upsert (daemon → cloud), through the shared normalizer
// ─────────────────────────────────────────────────────────────────────────────

export const upsert = internalMutation({
	args: {
		...scopeValidator,
		content: v.string(),
		baseVersion: v.optional(v.number()),
	},
	returns: upsertResult,
	handler: async (ctx, args) => {
		const n = parseEntity(args.content);
		const now = Date.now();

		if (n.kind === "issue") {
			const team = await ctx.db
				.query("teams")
				.withIndex("by_workspace_key", (q) =>
					q.eq("workspaceId", args.workspaceId).eq("key", n.fields.team),
				)
				.unique();
			if (!team) throw new Error(`Unknown team '${n.fields.team}'`);
			if (!args.teamIds.some((id) => id === team._id)) {
				throw new Error("Token not scoped to this team");
			}
			const existing = await ctx.db
				.query("issues")
				.withIndex("by_workspace_ulid", (q) =>
					q.eq("workspaceId", args.workspaceId).eq("ulid", n.fields.id),
				)
				.unique();

			if (existing) {
				// Authorize against the EXISTING issue's team (never the submitted
				// one) and forbid re-homing it into a different team. This must run
				// before any conflict-return so out-of-scope content can't leak.
				if (!args.teamIds.some((id) => id === existing.teamId)) {
					throw new Error("Token not scoped to this team");
				}
				if (existing.teamId !== team._id) {
					throw new Error("Cannot move an issue to a different team");
				}
				if (
					args.baseVersion !== undefined &&
					args.baseVersion !== existing.version
				) {
					return {
						status: "conflict",
						ulid: existing.ulid,
						version: existing.version,
						identifier: existing.identifier,
						content: existing.content,
					};
				}
				const created =
					(splitRaw(existing.content).frontmatter.created as
						| string
						| undefined) ?? new Date(existing._creationTime).toISOString();
				const rebuilt = buildIssue(
					{
						...n.fields,
						identifier: existing.identifier,
						created,
						updated: new Date(now).toISOString(),
					},
					n.body,
					n.extra,
				);
				const version = existing.version + 1;
				await ctx.db.replace(
					existing._id,
					issueColumns(rebuilt, {
						workspaceId: args.workspaceId,
						teamId: existing.teamId,
						identifier: existing.identifier,
						number: existing.number,
						version,
						updatedAt: now,
						archivedAt: existing.archivedAt,
						deletedAt: existing.deletedAt,
					}),
				);
				await syncEdges(
					ctx,
					args.workspaceId,
					existing.ulid,
					issueEdges(rebuilt),
				);
				await logEvent(ctx, {
					workspaceId: args.workspaceId,
					entityUlid: existing.ulid,
					entityType: "issue",
					kind: "updated",
					actorType: "agent",
					actorId: args.userId,
				});
				return {
					status: "applied",
					ulid: existing.ulid,
					version,
					identifier: existing.identifier,
					content: rebuilt.content,
				};
			}

			const number = team.nextIssueNumber;
			const identifier = `${team.key}-${number}`;
			await ctx.db.patch(team._id, { nextIssueNumber: number + 1 });
			const created = new Date(now).toISOString();
			const rebuilt = buildIssue(
				{ ...n.fields, identifier, created, updated: created },
				n.body,
				n.extra,
			);
			await ctx.db.insert(
				"issues",
				issueColumns(rebuilt, {
					workspaceId: args.workspaceId,
					teamId: team._id,
					identifier,
					number,
					version: 1,
					updatedAt: now,
				}),
			);
			await syncEdges(
				ctx,
				args.workspaceId,
				rebuilt.fields.id,
				issueEdges(rebuilt),
			);
			await logEvent(ctx, {
				workspaceId: args.workspaceId,
				entityUlid: rebuilt.fields.id,
				entityType: "issue",
				kind: "created",
				actorType: "agent",
				actorId: args.userId,
			});
			return {
				status: "created",
				ulid: rebuilt.fields.id,
				version: 1,
				identifier,
				content: rebuilt.content,
			};
		}

		// document / plan
		const teamKey = (n.fields as { team?: string | null }).team ?? undefined;
		let teamId: Id<"teams"> | undefined;
		if (teamKey) {
			const team = await ctx.db
				.query("teams")
				.withIndex("by_workspace_key", (q) =>
					q.eq("workspaceId", args.workspaceId).eq("key", teamKey),
				)
				.unique();
			if (!team) throw new Error(`Unknown team '${teamKey}'`);
			if (!args.teamIds.some((id) => id === team._id)) {
				throw new Error("Token not scoped to this team");
			}
			teamId = team._id;
		}
		const existing = await ctx.db
			.query("documents")
			.withIndex("by_workspace_ulid", (q) =>
				q.eq("workspaceId", args.workspaceId).eq("ulid", n.fields.id),
			)
			.unique();

		if (existing) {
			// Authorize against the EXISTING document's team (team-less docs are
			// workspace-visible); the submitted teamKey only governs creation.
			// Must run before any conflict-return to avoid leaking content.
			if (
				existing.teamId !== undefined &&
				!args.teamIds.some((id) => id === existing.teamId)
			) {
				throw new Error("Token not scoped to this team");
			}
			if (
				args.baseVersion !== undefined &&
				args.baseVersion !== existing.version
			) {
				return {
					status: "conflict",
					ulid: existing.ulid,
					version: existing.version,
					content: existing.content,
				};
			}
			const created =
				(splitRaw(existing.content).frontmatter.created as
					| string
					| undefined) ?? new Date(existing._creationTime).toISOString();
			const rebuilt = buildDocument(
				{ ...n.fields, created, updated: new Date(now).toISOString() },
				n.body,
				n.extra,
			);
			const version = existing.version + 1;
			await ctx.db.replace(
				existing._id,
				documentColumns(rebuilt, {
					workspaceId: args.workspaceId,
					teamId: existing.teamId,
					version,
					updatedAt: now,
					archivedAt: existing.archivedAt,
					deletedAt: existing.deletedAt,
				}),
			);
			await logEvent(ctx, {
				workspaceId: args.workspaceId,
				entityUlid: existing.ulid,
				entityType: "document",
				kind: "updated",
				actorType: "agent",
				actorId: args.userId,
			});
			return {
				status: "applied",
				ulid: existing.ulid,
				version,
				content: rebuilt.content,
			};
		}

		const created = new Date(now).toISOString();
		const rebuilt = buildDocument(
			{ ...n.fields, created, updated: created },
			n.body,
			n.extra,
		);
		await ctx.db.insert(
			"documents",
			documentColumns(rebuilt, {
				workspaceId: args.workspaceId,
				teamId,
				version: 1,
				updatedAt: now,
			}),
		);
		await logEvent(ctx, {
			workspaceId: args.workspaceId,
			entityUlid: rebuilt.fields.id,
			entityType: "document",
			kind: "created",
			actorType: "agent",
			actorId: args.userId,
		});
		return {
			status: "created",
			ulid: rebuilt.fields.id,
			version: 1,
			content: rebuilt.content,
		};
	},
});

export const remove = internalMutation({
	args: { ...scopeValidator, ulid: v.string() },
	returns: v.object({ status: v.string() }),
	handler: async (ctx, args) => {
		const now = Date.now();
		const issue = await ctx.db
			.query("issues")
			.withIndex("by_workspace_ulid", (q) =>
				q.eq("workspaceId", args.workspaceId).eq("ulid", args.ulid),
			)
			.unique();
		if (issue) {
			if (!args.teamIds.some((id) => id === issue.teamId)) {
				throw new Error("Token not scoped to this team");
			}
			if (issue.deletedAt === undefined) {
				await ctx.db.patch(issue._id, {
					deletedAt: now,
					updatedAt: now,
					version: issue.version + 1,
				});
				await syncEdges(ctx, args.workspaceId, issue.ulid, []);
				await logEvent(ctx, {
					workspaceId: args.workspaceId,
					entityUlid: issue.ulid,
					entityType: "issue",
					kind: "deleted",
					actorType: "agent",
					actorId: args.userId,
				});
			}
			return { status: "deleted" };
		}
		const doc = await ctx.db
			.query("documents")
			.withIndex("by_workspace_ulid", (q) =>
				q.eq("workspaceId", args.workspaceId).eq("ulid", args.ulid),
			)
			.unique();
		if (doc) {
			if (doc.teamId && !args.teamIds.some((id) => id === doc.teamId)) {
				throw new Error("Token not scoped to this team");
			}
			if (doc.deletedAt === undefined) {
				await ctx.db.patch(doc._id, {
					deletedAt: now,
					updatedAt: now,
					version: doc.version + 1,
				});
				await logEvent(ctx, {
					workspaceId: args.workspaceId,
					entityUlid: doc.ulid,
					entityType: "document",
					kind: "deleted",
					actorType: "agent",
					actorId: args.userId,
				});
			}
			return { status: "deleted" };
		}
		return { status: "not_found" };
	},
});

export const commits = internalMutation({
	args: {
		...scopeValidator,
		commits: v.array(
			v.object({
				sha: v.string(),
				message: v.string(),
				branch: v.optional(v.string()),
			}),
		),
	},
	returns: v.object({ linked: v.number(), closed: v.array(v.string()) }),
	handler: async (ctx, args) => {
		let linked = 0;
		const closed: string[] = [];
		for (const c of args.commits) {
			const idents = extractIdentifiers(`${c.message}\n${c.branch ?? ""}`);
			for (const ident of idents) {
				const issue = await ctx.db
					.query("issues")
					.withIndex("by_workspace_identifier", (q) =>
						q.eq("workspaceId", args.workspaceId).eq("identifier", ident),
					)
					.unique();
				if (!issue || issue.deletedAt !== undefined) continue;
				if (!args.teamIds.some((id) => id === issue.teamId)) continue;
				await logEvent(ctx, {
					workspaceId: args.workspaceId,
					entityUlid: issue.ulid,
					entityType: "issue",
					kind: "commit",
					actorType: "agent",
					actorId: args.userId,
					data: { sha: c.sha, message: c.message, branch: c.branch },
				});
				linked++;
				if (closesIdentifier(c.message, ident) && issue.status !== "done") {
					const now = Date.now();
					const parsed = parseEntity(issue.content);
					if (parsed.kind === "issue") {
						const created =
							(splitRaw(issue.content).frontmatter.created as
								| string
								| undefined) ?? new Date(issue._creationTime).toISOString();
						const rebuilt = buildIssue(
							{
								...parsed.fields,
								status: "done",
								created,
								updated: new Date(now).toISOString(),
							},
							parsed.body,
							parsed.extra,
						);
						await ctx.db.replace(
							issue._id,
							issueColumns(rebuilt, {
								workspaceId: args.workspaceId,
								teamId: issue.teamId,
								identifier: issue.identifier,
								number: issue.number,
								version: issue.version + 1,
								updatedAt: now,
								archivedAt: issue.archivedAt,
								deletedAt: issue.deletedAt,
							}),
						);
						await logEvent(ctx, {
							workspaceId: args.workspaceId,
							entityUlid: issue.ulid,
							entityType: "issue",
							kind: "status_changed",
							actorType: "agent",
							actorId: args.userId,
							data: { to: "done", via: c.sha },
						});
						closed.push(ident);
					}
				}
			}
		}
		return { linked, closed };
	},
});

// ─────────────────────────────────────────────────────────────────────────────
// Public actions (token-authenticated; called by the daemon over HTTP)
// ─────────────────────────────────────────────────────────────────────────────

// Explicit return type breaks a circular type-inference cycle (the actions below
// call this, and its inferred type would otherwise depend on theirs via `api`).
async function requireScope(
	ctx: ActionCtx,
	token: string,
): Promise<{
	userId: Id<"users">;
	workspaceId: Id<"workspaces">;
	teamIds: Id<"teams">[];
}> {
	const scope = await ctx.runQuery(internal.sync.tokenScope, {
		tokenHash: await sha256Hex(token),
	});
	if (!scope) throw new Error("Invalid or revoked device token");
	return scope;
}

export const hello = action({
	args: { token: v.string() },
	returns: infoReturn,
	handler: async (ctx, args): Promise<Infer<typeof infoReturn>> => {
		const scope = await requireScope(ctx, args.token);
		return await ctx.runQuery(internal.sync.info, {
			workspaceId: scope.workspaceId,
			teamIds: scope.teamIds,
		});
	},
});

export const pull = action({
	args: { token: v.string(), since: v.optional(v.number()) },
	returns: changesReturn,
	handler: async (ctx, args): Promise<Infer<typeof changesReturn>> => {
		const scope = await requireScope(ctx, args.token);
		return await ctx.runQuery(internal.sync.changes, {
			workspaceId: scope.workspaceId,
			teamIds: scope.teamIds,
			since: args.since ?? 0,
		});
	},
});

export const push = action({
	args: {
		token: v.string(),
		upserts: v.optional(
			v.array(
				v.object({ content: v.string(), baseVersion: v.optional(v.number()) }),
			),
		),
		deletes: v.optional(v.array(v.string())),
	},
	returns: pushReturn,
	handler: async (ctx, args): Promise<Infer<typeof pushReturn>> => {
		const scope = await requireScope(ctx, args.token);
		const results: Array<{
			status: string;
			ulid: string;
			version: number;
			identifier?: string;
			content: string;
			error?: string;
		}> = [];
		for (const u of args.upserts ?? []) {
			try {
				const r = await ctx.runMutation(internal.sync.upsert, {
					...scope,
					content: u.content,
					baseVersion: u.baseVersion,
				});
				results.push(r);
			} catch (e) {
				results.push({
					status: "error",
					ulid: "",
					version: 0,
					content: "",
					error: e instanceof Error ? e.message : "error",
				});
			}
		}
		const deleted: { ulid: string; status: string }[] = [];
		for (const ulid of args.deletes ?? []) {
			try {
				const r = await ctx.runMutation(internal.sync.remove, {
					...scope,
					ulid,
				});
				deleted.push({ ulid, status: r.status });
			} catch (e) {
				deleted.push({
					ulid,
					status: e instanceof Error ? e.message : "error",
				});
			}
		}
		return { results, deleted };
	},
});

export const linkCommits = action({
	args: {
		token: v.string(),
		commits: v.array(
			v.object({
				sha: v.string(),
				message: v.string(),
				branch: v.optional(v.string()),
			}),
		),
	},
	returns: commitsReturn,
	handler: async (ctx, args): Promise<Infer<typeof commitsReturn>> => {
		const scope = await requireScope(ctx, args.token);
		return await ctx.runMutation(internal.sync.commits, {
			...scope,
			commits: args.commits,
		});
	},
});
