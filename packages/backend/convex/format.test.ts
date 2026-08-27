import { expect, test } from "vitest";
import {
	FormatError,
	buildDocument,
	buildIssue,
	generateUlid,
	parseEntity,
} from "./lib/format";

// Deterministic, valid ULID (26 Crockford chars).
const ID = generateUlid(0, () => 0);

test("generateUlid always produces valid ULIDs", () => {
	expect(ID).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
	for (let i = 0; i < 100; i++) {
		expect(generateUlid()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/i);
	}
});

test("issue round-trips through canonical content", () => {
	const n = buildIssue(
		{
			id: ID,
			identifier: "ENG-1",
			type: "issue",
			title: "Add OAuth: login",
			status: "in_progress",
			team: "ENG",
			priority: "high",
			labels: ["auth", "backend"],
			created: "2026-06-14T09:00:00Z",
			updated: "2026-06-14T09:00:00Z",
		},
		"# Add OAuth\n\nBody here.",
	);

	// A colon in the title forces YAML quoting.
	expect(n.content).toContain('title: "Add OAuth: login"');
	// Timestamps are quoted so YAML keeps them as strings.
	expect(n.content).toContain('created: "2026-06-14T09:00:00Z"');

	const parsed = parseEntity(n.content);
	expect(parsed.kind).toBe("issue");
	// Parsing then re-serializing is idempotent.
	expect(parsed.content).toBe(n.content);
	expect(parsed.contentHash).toBe(n.contentHash);
	expect(parsed.body).toBe(n.body);
	if (parsed.kind === "issue") {
		expect(parsed.fields.title).toBe("Add OAuth: login");
		expect(parsed.fields.status).toBe("in_progress");
		expect(parsed.fields.labels).toEqual(["auth", "backend"]);
		expect(parsed.fields.id).toBe(ID);
	}
});

test("serialization is deterministic", () => {
	const make = () =>
		buildIssue(
			{ id: ID, type: "issue", title: "T", status: "todo", team: "ENG" },
			"x",
		).content;
	expect(make()).toBe(make());
});

test("contentHash changes when content changes", () => {
	const a = buildIssue(
		{ id: ID, type: "issue", title: "A", status: "todo", team: "ENG" },
		"",
	).contentHash;
	const b = buildIssue(
		{ id: ID, type: "issue", title: "B", status: "todo", team: "ENG" },
		"",
	).contentHash;
	expect(a).not.toBe(b);
});

test("empty optional fields are omitted from frontmatter", () => {
	const n = buildIssue(
		{ id: ID, type: "issue", title: "T", status: "todo", team: "ENG" },
		"",
	);
	expect(n.content).not.toContain("assignee:"); // absent optional omitted
	expect(n.content).not.toContain("labels:"); // empty array omitted
	expect(n.content).toContain("priority: none"); // zod default is emitted
});

test("rejects invalid issues", () => {
	expect(() =>
		buildIssue(
			{ id: ID, type: "issue", title: "", status: "todo", team: "ENG" },
			"",
		),
	).toThrow(FormatError);
	expect(() =>
		buildIssue(
			{
				id: "not-a-ulid",
				type: "issue",
				title: "T",
				status: "todo",
				team: "ENG",
			},
			"",
		),
	).toThrow(FormatError);
});

test("parseEntity rejects unknown/missing type", () => {
	expect(() => parseEntity("---\ntype: widget\n---\n")).toThrow(FormatError);
	expect(() => parseEntity("no frontmatter here")).toThrow(FormatError);
});

test("documents and plans round-trip", () => {
	const doc = buildDocument({ id: ID, type: "doc", title: "Spec" }, "# Spec");
	expect(doc.docType).toBe("doc");
	expect(parseEntity(doc.content).kind).toBe("document");

	const plan = buildDocument(
		{ id: ID, type: "plan", title: "Launch", planStatus: "active", parent: ID },
		"# Plan",
	);
	expect(plan.docType).toBe("plan");
	if (plan.kind === "document" && plan.fields.type === "plan") {
		expect(plan.fields.planStatus).toBe("active");
		expect(plan.fields.parent).toBe(ID);
	}
	const reparsed = parseEntity(plan.content);
	expect(reparsed.content).toBe(plan.content);
});

test("round-trips strings that are YAML-ambiguous (newlines, indicators, number-like)", () => {
	const tricky = [
		"Line1\nLine2",
		"-",
		"? maybe",
		"0x1F",
		".inf",
		".nan",
		'has " quote and \\ backslash',
		"a: b # c",
		"tab\there",
	];
	for (const value of tricky) {
		const n = buildIssue(
			{
				id: ID,
				type: "issue",
				title: "T",
				status: "todo",
				team: "ENG",
				assignee: value,
			},
			"body",
		);
		const parsed = parseEntity(n.content);
		expect(parsed.kind).toBe("issue");
		if (parsed.kind === "issue") {
			expect(parsed.fields.assignee).toBe(value);
		}
		// idempotent
		expect(parsed.content).toBe(n.content);
	}
});

test("a title containing a --- line cannot truncate the frontmatter", () => {
	const n = buildIssue(
		{ id: ID, type: "issue", title: 'a"\n---\nb', status: "todo", team: "ENG" },
		"real body",
	);
	const parsed = parseEntity(n.content);
	expect(parsed.kind).toBe("issue");
	if (parsed.kind === "issue") {
		expect(parsed.fields.title).toBe('a"\n---\nb');
		expect(parsed.fields.status).toBe("todo");
	}
	expect(parsed.body).toBe("real body");
});

test("parses files with CRLF line endings", () => {
	const lf = buildIssue(
		{ id: ID, type: "issue", title: "T", status: "todo", team: "ENG" },
		"Body line",
	).content;
	const parsed = parseEntity(lf.replace(/\n/g, "\r\n"));
	expect(parsed.kind).toBe("issue");
	if (parsed.kind === "issue") expect(parsed.fields.title).toBe("T");
	expect(parsed.body).toBe("Body line");
});

test("preserves unknown frontmatter fields (round-trip, sorted)", () => {
	// A realistic ULID (contains letters) so hand-written unquoted YAML doesn't
	// parse it as a number. (The serializer quotes numeric-looking ids itself.)
	const realId = "01HZX7Q8K9V0ABCDEFGH012345";
	const raw = `---\nid: ${realId}\ntype: issue\ntitle: T\nstatus: todo\nteam: ENG\nsprint: 4\nrisk: high\n---\n\nBody`;
	const n = parseEntity(raw);
	expect(n.kind).toBe("issue");
	expect(n.extra).toEqual({ sprint: 4, risk: "high" });
	expect(n.content).toContain("risk: high");
	expect(n.content).toContain("sprint: 4");
	// Known fields still validated; unknowns appended; whole thing idempotent.
	expect(parseEntity(n.content).content).toBe(n.content);
});
