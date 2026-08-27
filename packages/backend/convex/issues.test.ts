import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Module map for convex-test. Must include _generated (used to locate the
// modules root); skip the component config and the test files themselves.
const modules = import.meta.glob([
	"./**/*.*s",
	"!./**/*.test.ts",
	"!./convex.config.ts",
]);

const ADMIN = {
	subject: "user_admin",
	name: "Admin",
	email: "admin@x.com",
	org_id: "org_1",
	org_role: "org:admin",
};
const SAME_ORG_NON_TEAM = {
	subject: "user_member",
	name: "Member",
	email: "member@x.com",
	org_id: "org_1",
	org_role: "org:member",
};
const OTHER_ORG = {
	subject: "user_outsider",
	name: "Outsider",
	email: "out@x.com",
	org_id: "org_2",
	org_role: "org:admin",
};

test("create team + issue, list, get, identifiers increment", async () => {
	const t = convexTest(schema, modules);
	const admin = t.withIdentity(ADMIN);
	await admin.mutation(api.users.bootstrap, {});
	const team = await admin.mutation(api.teams.create, {
		key: "eng",
		name: "Engineering",
	});

	const a = await admin.mutation(api.issues.create, {
		teamId: team.id,
		title: "Add OAuth login",
	});
	const b = await admin.mutation(api.issues.create, {
		teamId: team.id,
		title: "Org switching",
	});
	expect(a.identifier).toBe("ENG-1"); // key upcased, counter from 1
	expect(b.identifier).toBe("ENG-2");

	const list = await admin.query(api.issues.list, { teamId: team.id });
	expect(list.length).toBe(2);

	const detail = await admin.query(api.issues.get, { issueId: a.id });
	expect(detail?.title).toBe("Add OAuth login");
	expect(detail?.content).toContain("identifier: ENG-1");
	expect(detail?.version).toBe(1);
});

test("update enforces optimistic concurrency", async () => {
	const t = convexTest(schema, modules);
	const admin = t.withIdentity(ADMIN);
	await admin.mutation(api.users.bootstrap, {});
	const team = await admin.mutation(api.teams.create, {
		key: "ENG",
		name: "Eng",
	});
	const issue = await admin.mutation(api.issues.create, {
		teamId: team.id,
		title: "T",
	});

	const r = await admin.mutation(api.issues.update, {
		issueId: issue.id,
		expectedVersion: 1,
		status: "in_progress",
	});
	expect(r.version).toBe(2);

	await expect(
		admin.mutation(api.issues.update, {
			issueId: issue.id,
			expectedVersion: 1, // stale
			title: "x",
		}),
	).rejects.toThrow(/conflict/i);

	const detail = await admin.query(api.issues.get, { issueId: issue.id });
	expect(detail?.status).toBe("in_progress");
	expect(detail?.content).toContain("status: in_progress");
});

test("clearing a field with null removes it from content", async () => {
	const t = convexTest(schema, modules);
	const admin = t.withIdentity(ADMIN);
	await admin.mutation(api.users.bootstrap, {});
	const team = await admin.mutation(api.teams.create, {
		key: "ENG",
		name: "Eng",
	});
	const issue = await admin.mutation(api.issues.create, {
		teamId: team.id,
		title: "T",
		assignee: "joe@x.com",
	});
	let detail = await admin.query(api.issues.get, { issueId: issue.id });
	expect(detail?.assignee).toBe("joe@x.com");

	await admin.mutation(api.issues.update, {
		issueId: issue.id,
		assignee: null,
	});
	detail = await admin.query(api.issues.get, { issueId: issue.id });
	expect(detail?.assignee).toBeUndefined();
	expect(detail?.content).not.toContain("assignee:");
});

test("soft-delete tombstones the issue (hidden from reads)", async () => {
	const t = convexTest(schema, modules);
	const admin = t.withIdentity(ADMIN);
	await admin.mutation(api.users.bootstrap, {});
	const team = await admin.mutation(api.teams.create, {
		key: "ENG",
		name: "Eng",
	});
	const issue = await admin.mutation(api.issues.create, {
		teamId: team.id,
		title: "T",
	});
	await admin.mutation(api.issues.remove, { issueId: issue.id });
	expect(await admin.query(api.issues.get, { issueId: issue.id })).toBeNull();
	expect((await admin.query(api.issues.list, { teamId: team.id })).length).toBe(
		0,
	);
});

test("SECURITY: team boundaries are enforced server-side", async () => {
	const t = convexTest(schema, modules);

	// Admin in org_1 owns the ENG team + a secret issue.
	const admin = t.withIdentity(ADMIN);
	await admin.mutation(api.users.bootstrap, {});
	const team = await admin.mutation(api.teams.create, {
		key: "ENG",
		name: "Eng",
	});
	const secret = await admin.mutation(api.issues.create, {
		teamId: team.id,
		title: "secret roadmap",
	});

	// Unauthenticated callers are rejected outright.
	await expect(t.query(api.issues.list, { teamId: team.id })).rejects.toThrow();

	// A user in a DIFFERENT org cannot list (team not in their workspace)…
	const outsider = t.withIdentity(OTHER_ORG);
	await outsider.mutation(api.users.bootstrap, {});
	await expect(
		outsider.query(api.issues.list, { teamId: team.id }),
	).rejects.toThrow();
	// …and cross-workspace get leaks nothing (returns null).
	expect(
		await outsider.query(api.issues.get, { issueId: secret.id }),
	).toBeNull();

	// A user in the SAME org but NOT a team member is denied.
	const member = t.withIdentity(SAME_ORG_NON_TEAM);
	await member.mutation(api.users.bootstrap, {});
	await expect(
		member.query(api.issues.list, { teamId: team.id }),
	).rejects.toThrow(/not a member/i);
	await expect(
		member.query(api.issues.get, { issueId: secret.id }),
	).rejects.toThrow(/not a member/i);
	// And cannot mutate.
	await expect(
		member.mutation(api.issues.update, { issueId: secret.id, title: "hacked" }),
	).rejects.toThrow(/not a member/i);

	// Once the admin grants membership, access is allowed.
	await admin.mutation(api.teams.addMember, {
		teamId: team.id,
		clerkUserId: "user_member",
	});
	const list = await member.query(api.issues.list, { teamId: team.id });
	expect(list.length).toBe(1);
});

test("documents and plans: create + list", async () => {
	const t = convexTest(schema, modules);
	const admin = t.withIdentity(ADMIN);
	await admin.mutation(api.users.bootstrap, {});

	await admin.mutation(api.documents.create, {
		docType: "doc",
		title: "Auth architecture",
		body: "# Auth\n\nDetails.",
	});
	const plan = await admin.mutation(api.documents.create, {
		docType: "plan",
		title: "Launch plan",
		planStatus: "active",
	});
	const planDetail = await admin.query(api.documents.get, {
		documentId: plan.id,
	});
	expect(planDetail?.docType).toBe("plan");
	expect(planDetail?.planStatus).toBe("active");
	expect(planDetail?.content).toContain("type: plan");

	const docs = await admin.query(api.documents.list, {});
	expect(docs.length).toBe(2);
	const plans = await admin.query(api.documents.list, { docType: "plan" });
	expect(plans.length).toBe(1);
});

test("bootstrap reports needs_org when no active organization", async () => {
	const t = convexTest(schema, modules);
	const noOrg = t.withIdentity({ subject: "user_solo", name: "Solo" });
	const result = await noOrg.mutation(api.users.bootstrap, {});
	expect(result.status).toBe("needs_org");
	expect(result.workspace).toBeUndefined();
});

test("SECURITY: team-scoped documents are not readable cross-team", async () => {
	const t = convexTest(schema, modules);
	const admin = t.withIdentity(ADMIN);
	await admin.mutation(api.users.bootstrap, {});
	const team = await admin.mutation(api.teams.create, {
		key: "SEC",
		name: "Security",
	});
	const doc = await admin.mutation(api.documents.create, {
		docType: "plan",
		title: "secret plan",
		teamId: team.id,
	});

	// Same-org member who is NOT in team SEC must not see the doc.
	const member = t.withIdentity(SAME_ORG_NON_TEAM);
	await member.mutation(api.users.bootstrap, {});
	expect(
		await member.query(api.documents.get, { documentId: doc.id }),
	).toBeNull();
	const visible = await member.query(api.documents.list, {});
	expect(visible.find((d) => d.id === doc.id)).toBeUndefined();
	await expect(
		member.query(api.events.listForEntity, { entityUlid: doc.ulid }),
	).rejects.toThrow(/not a member/i);

	// The SEC admin can read it.
	const got = await admin.query(api.documents.get, { documentId: doc.id });
	expect(got?.title).toBe("secret plan");
});

test("SECURITY: events.listForEntity enforces issue team membership", async () => {
	const t = convexTest(schema, modules);
	const admin = t.withIdentity(ADMIN);
	await admin.mutation(api.users.bootstrap, {});
	const team = await admin.mutation(api.teams.create, {
		key: "ENG",
		name: "Eng",
	});
	const issue = await admin.mutation(api.issues.create, {
		teamId: team.id,
		title: "x",
	});

	const member = t.withIdentity(SAME_ORG_NON_TEAM);
	await member.mutation(api.users.bootstrap, {});
	await expect(
		member.query(api.events.listForEntity, { entityUlid: issue.ulid }),
	).rejects.toThrow(/not a member/i);

	const activity = await admin.query(api.events.listForEntity, {
		entityUlid: issue.ulid,
	});
	expect(activity.length).toBeGreaterThan(0);
});
