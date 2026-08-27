import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Reusable validators. Exported so functions can validate args with the same
 * source of truth as the schema (and the normalizer in `lib/format.ts`).
 */
export const issueStatusValidator = v.union(
	v.literal("backlog"),
	v.literal("todo"),
	v.literal("in_progress"),
	v.literal("in_review"),
	v.literal("done"),
	v.literal("canceled"),
);

export const priorityValidator = v.union(
	v.literal("none"),
	v.literal("low"),
	v.literal("medium"),
	v.literal("high"),
	v.literal("urgent"),
);

export const docTypeValidator = v.union(v.literal("doc"), v.literal("plan"));

export const planStatusValidator = v.union(
	v.literal("draft"),
	v.literal("approved"),
	v.literal("active"),
	v.literal("superseded"),
	v.literal("done"),
);

export const roleValidator = v.union(v.literal("admin"), v.literal("member"));

export const actorTypeValidator = v.union(
	v.literal("human"),
	v.literal("agent"),
	v.literal("system"),
);

export default defineSchema({
	/** Mirror of Clerk users, keyed by the Clerk subject. */
	users: defineTable({
		clerkUserId: v.string(),
		email: v.optional(v.string()),
		name: v.optional(v.string()),
		imageUrl: v.optional(v.string()),
	}).index("by_clerk", ["clerkUserId"]),

	/** A workspace ↔ a Clerk Organization. */
	workspaces: defineTable({
		clerkOrgId: v.string(),
		name: v.string(),
		slug: v.string(),
	})
		.index("by_clerkOrg", ["clerkOrgId"])
		.index("by_slug", ["slug"]),

	/** Workspace membership (mirrors Clerk org membership; provisioned lazily from JWT). */
	workspaceMembers: defineTable({
		workspaceId: v.id("workspaces"),
		userId: v.id("users"),
		role: roleValidator,
	})
		.index("by_workspace", ["workspaceId"])
		.index("by_user", ["userId"])
		.index("by_workspace_user", ["workspaceId", "userId"]),

	/** A team within a workspace. `key` is the identifier prefix (e.g. ENG). */
	teams: defineTable({
		workspaceId: v.id("workspaces"),
		key: v.string(),
		name: v.string(),
		/** Monotonic counter for human display identifiers (ENG-1, ENG-2, …). */
		nextIssueNumber: v.number(),
	})
		.index("by_workspace", ["workspaceId"])
		.index("by_workspace_key", ["workspaceId", "key"]),

	/** Team membership — the access boundary. PikaSync-managed (not Clerk). */
	teamMembers: defineTable({
		teamId: v.id("teams"),
		workspaceId: v.id("workspaces"),
		userId: v.id("users"),
		role: roleValidator,
	})
		.index("by_team", ["teamId"])
		.index("by_user", ["userId"])
		.index("by_team_user", ["teamId", "userId"]),

	/**
	 * Issues. `content` is the canonical, verbatim Markdown file (frontmatter +
	 * body) — the content authority. Every other field is **derived** from it by
	 * the normalizer and is here only as an index/projection. They never diverge
	 * because only the normalizer writes, and it rewrites all of them together.
	 */
	issues: defineTable({
		workspaceId: v.id("workspaces"),
		teamId: v.id("teams"),

		// identity
		ulid: v.string(),
		identifier: v.string(),
		number: v.number(),

		// derived columns (projections of frontmatter)
		title: v.string(),
		status: issueStatusValidator,
		priority: priorityValidator,
		assignee: v.optional(v.string()),
		estimate: v.optional(v.number()),
		labels: v.array(v.string()),
		due: v.optional(v.string()),

		// relations (ULID refs; the inverse index lives in `edges`)
		project: v.optional(v.string()),
		milestone: v.optional(v.string()),
		plan: v.optional(v.string()),
		planSection: v.optional(v.string()),
		parent: v.optional(v.string()),
		blockedBy: v.array(v.string()),

		// content authority + derived body projection
		content: v.string(),
		body: v.string(),
		contentHash: v.string(),
		version: v.number(),

		// lifecycle
		updatedAt: v.number(),
		archivedAt: v.optional(v.number()),
		deletedAt: v.optional(v.number()),
	})
		.index("by_workspace", ["workspaceId"])
		.index("by_team", ["teamId"])
		.index("by_team_status", ["teamId", "status"])
		.index("by_workspace_ulid", ["workspaceId", "ulid"])
		.index("by_workspace_identifier", ["workspaceId", "identifier"])
		.index("by_assignee", ["workspaceId", "assignee"]),

	/** Documents and plans (a plan is a document subtype). */
	documents: defineTable({
		workspaceId: v.id("workspaces"),
		teamId: v.optional(v.id("teams")),

		ulid: v.string(),
		docType: docTypeValidator,
		title: v.string(),
		project: v.optional(v.string()),

		// plan-only fields
		planStatus: v.optional(planStatusValidator),
		parent: v.optional(v.string()),
		supersedes: v.optional(v.string()),
		executedVersion: v.optional(v.number()),

		content: v.string(),
		body: v.string(),
		contentHash: v.string(),
		version: v.number(),

		updatedAt: v.number(),
		archivedAt: v.optional(v.number()),
		deletedAt: v.optional(v.number()),
	})
		.index("by_workspace", ["workspaceId"])
		.index("by_team", ["teamId"])
		.index("by_workspace_type", ["workspaceId", "docType"])
		.index("by_workspace_ulid", ["workspaceId", "ulid"]),

	/** Typed-edge graph / inverse relationship index. */
	edges: defineTable({
		workspaceId: v.id("workspaces"),
		type: v.string(),
		sourceUlid: v.string(),
		targetUlid: v.string(),
	})
		.index("by_source", ["workspaceId", "sourceUlid"])
		.index("by_target", ["workspaceId", "targetUlid"])
		.index("by_type_target", ["workspaceId", "type", "targetUlid"]),

	/** Activity log. Crucially carries who acted — human vs agent. */
	events: defineTable({
		workspaceId: v.id("workspaces"),
		entityUlid: v.string(),
		entityType: v.string(),
		kind: v.string(),
		actorType: actorTypeValidator,
		actorId: v.optional(v.string()),
		data: v.optional(v.any()),
	})
		.index("by_entity", ["workspaceId", "entityUlid"])
		.index("by_workspace", ["workspaceId"]),

	/** Per-device tokens for the daemon/CLI — scoped, listable, revocable. */
	deviceTokens: defineTable({
		workspaceId: v.id("workspaces"),
		userId: v.id("users"),
		name: v.string(),
		/** SHA-256 of the secret; the plaintext is shown once and never stored. */
		tokenHash: v.string(),
		/** Short visible prefix for UI display (e.g. "pk_live_AbCd…"). */
		prefix: v.string(),
		scopeTeamIds: v.array(v.id("teams")),
		createdAt: v.number(),
		lastUsedAt: v.optional(v.number()),
		revokedAt: v.optional(v.number()),
	})
		.index("by_user", ["userId"])
		.index("by_workspace", ["workspaceId"])
		.index("by_hash", ["tokenHash"]),
});
