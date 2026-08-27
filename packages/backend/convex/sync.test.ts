import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { buildIssue, generateUlid } from "./lib/format";
import { sha256Hex } from "./lib/token";
import schema from "./schema";

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

const ISO = "2026-06-14T09:00:00Z";

async function setup() {
	const t = convexTest(schema, modules);
	const admin = t.withIdentity(ADMIN);
	const boot = await admin.mutation(api.users.bootstrap, {});
	const team = await admin.mutation(api.teams.create, {
		key: "ENG",
		name: "Eng",
	});
	const me = await admin.query(api.users.current, {});
	const token = "pk_test_daemon_secret";
	const tokenHash = await sha256Hex(token);
	if (!boot.workspace || !me) throw new Error("setup failed");
	const workspaceId = boot.workspace.id;
	const userId = me.user.id;
	await t.run(async (ctx) => {
		await ctx.db.insert("deviceTokens", {
			workspaceId,
			userId,
			name: "test device",
			tokenHash,
			prefix: token.slice(0, 11),
			scopeTeamIds: [team.id],
			createdAt: Date.now(),
		});
	});
	return { t, admin, team, token, workspaceId };
}

function issueFile(ulid: string, title: string, status = "todo") {
	return buildIssue(
		{
			id: ulid,
			type: "issue",
			title,
			status,
			team: "ENG",
			created: ISO,
			updated: ISO,
		},
		"Issue body.",
	).content;
}

test("hello returns the token's workspace + scoped teams", async () => {
	const { t, token, workspaceId } = await setup();
	const info = await t.action(api.sync.hello, { token });
	expect(info.workspace.id).toBe(workspaceId);
	expect(info.teams.map((x) => x.key)).toEqual(["ENG"]);
});

test("invalid token is rejected", async () => {
	const { t } = await setup();
	await expect(t.action(api.sync.hello, { token: "pk_wrong" })).rejects.toThrow(
		/invalid|revoked/i,
	);
});

test("push creates an issue (cloud assigns identifier) and pull returns it", async () => {
	const { t, admin, token } = await setup();
	const ulid = generateUlid();
	const res = await t.action(api.sync.push, {
		token,
		upserts: [{ content: issueFile(ulid, "From the daemon") }],
	});
	expect(res.results[0].status).toBe("created");
	expect(res.results[0].identifier).toBe("ENG-1");
	expect(res.results[0].content).toContain("identifier: ENG-1");

	// Visible to the web side.
	const detail = await admin.query(api.issues.getByUlid, { ulid });
	expect(detail?.title).toBe("From the daemon");

	const pulled = await t.action(api.sync.pull, { token, since: 0 });
	expect(pulled.entities.some((e) => e.ulid === ulid)).toBe(true);
	expect(pulled.cursor).toBeGreaterThan(0);
});

test("push update enforces optimistic concurrency (conflict on stale base)", async () => {
	const { t, token } = await setup();
	const ulid = generateUlid();
	await t.action(api.sync.push, {
		token,
		upserts: [{ content: issueFile(ulid, "v1") }],
	});

	const ok = await t.action(api.sync.push, {
		token,
		upserts: [{ content: issueFile(ulid, "v2"), baseVersion: 1 }],
	});
	expect(ok.results[0].status).toBe("applied");
	expect(ok.results[0].version).toBe(2);

	// Re-pushing against the stale base version conflicts (no clobber).
	const conflict = await t.action(api.sync.push, {
		token,
		upserts: [{ content: issueFile(ulid, "v3"), baseVersion: 1 }],
	});
	expect(conflict.results[0].status).toBe("conflict");
	expect(conflict.results[0].version).toBe(2);
});

test("linkCommits records activity and auto-closes referenced issues", async () => {
	const { t, admin, token } = await setup();
	const ulid = generateUlid();
	await t.action(api.sync.push, {
		token,
		upserts: [{ content: issueFile(ulid, "wip") }],
	});

	const result = await t.action(api.sync.linkCommits, {
		token,
		commits: [
			{ sha: "abc1234", message: "fix ENG-1: handle redirect", branch: "main" },
		],
	});
	expect(result.linked).toBe(1);
	expect(result.closed).toContain("ENG-1");

	const detail = await admin.query(api.issues.getByUlid, { ulid });
	expect(detail?.status).toBe("done");
	expect(detail?.content).toContain("status: done");
});

test("push deletes tombstone the entity", async () => {
	const { t, admin, token } = await setup();
	const ulid = generateUlid();
	await t.action(api.sync.push, {
		token,
		upserts: [{ content: issueFile(ulid, "x") }],
	});
	const res = await t.action(api.sync.push, { token, deletes: [ulid] });
	expect(res.deleted[0].status).toBe("deleted");
	expect(await admin.query(api.issues.getByUlid, { ulid })).toBeNull();
	// Tombstone still surfaces in pull so the daemon can remove the file.
	const pulled = await t.action(api.sync.pull, { token, since: 0 });
	expect(pulled.entities.find((e) => e.ulid === ulid)?.deleted).toBe(true);
});

test("SECURITY: a token cannot write or read entities outside its team scope", async () => {
	const { t, admin, token } = await setup(); // token scoped to team ENG only
	// Admin owns a SECOND team + entities the token is NOT scoped to.
	const qa = await admin.mutation(api.teams.create, { key: "QA", name: "QA" });
	const victim = await admin.mutation(api.issues.create, {
		teamId: qa.id,
		title: "secret issue",
	});
	const victimDoc = await admin.mutation(api.documents.create, {
		docType: "plan",
		title: "secret plan",
		teamId: qa.id,
	});

	// Overwrite attempt: submit ENG-team content carrying QA's issue ULID.
	const malicious = buildIssue(
		{
			id: victim.ulid,
			type: "issue",
			title: "hijacked",
			status: "todo",
			team: "ENG",
			created: ISO,
			updated: ISO,
		},
		"pwned",
	).content;
	const r1 = await t.action(api.sync.push, {
		token,
		upserts: [{ content: malicious }],
	});
	expect(r1.results[0].status).toBe("error");
	expect(r1.results[0].content).toBe(""); // no content leaked

	// Conflict-read attempt (wrong baseVersion) is also denied, not leaked.
	const r2 = await t.action(api.sync.push, {
		token,
		upserts: [{ content: malicious, baseVersion: 0 }],
	});
	expect(r2.results[0].status).toBe("error");
	expect(r2.results[0].content).toBe("");

	// Team-scoped document, attacked by omitting the team field entirely.
	const maliciousDoc = `---\nid: ${victimDoc.ulid}\ntype: plan\ntitle: hijacked\n---\n\npwned`;
	const r3 = await t.action(api.sync.push, {
		token,
		upserts: [{ content: maliciousDoc, baseVersion: 0 }],
	});
	expect(r3.results[0].status).toBe("error");
	expect(r3.results[0].content).toBe("");

	// Victims are untouched.
	expect(
		(await admin.query(api.issues.getByUlid, { ulid: victim.ulid }))?.title,
	).toBe("secret issue");
	expect(
		(await admin.query(api.documents.get, { documentId: victimDoc.id }))?.title,
	).toBe("secret plan");
});

test("custom frontmatter survives sync create and a web update", async () => {
	const { t, admin, token } = await setup();
	const ulid = generateUlid();
	const content = `---\nid: ${ulid}\ntype: issue\ntitle: Custom\nstatus: todo\nteam: ENG\nsprint: 7\n---\n\nbody`;
	const res = await t.action(api.sync.push, { token, upserts: [{ content }] });
	expect(res.results[0].status).toBe("created");
	expect(res.results[0].content).toContain("sprint: 7");

	const issue = await admin.query(api.issues.getByUlid, { ulid });
	if (!issue) throw new Error("issue missing");
	await admin.mutation(api.issues.update, {
		issueId: issue.id,
		title: "Renamed",
	});
	const after = await admin.query(api.issues.getByUlid, { ulid });
	expect(after?.title).toBe("Renamed");
	expect(after?.content).toContain("sprint: 7"); // preserved through web edit
});
