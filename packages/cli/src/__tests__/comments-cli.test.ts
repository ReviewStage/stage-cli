import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CreateCommentThreadBody } from "@stagereview/types/comments";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commentsCommand, formatThreadLine } from "../comments/command.js";
import { CommentsCli } from "../comments/comments-cli.js";
import { closeDb, getDb, type StageDb } from "../db/client.js";
import { commentThread } from "../db/schema/index.js";
import { LocalCommentThreadStore } from "../runs/local-comment-threads.js";

const SCOPE_KEY = "committed:aaa:bbb:ccc";
const OTHER_SCOPE_KEY = "committed:ddd:eee:fff";

let tmpDir: string;
let db: StageDb;
let cli: CommentsCli;

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage-cli-comments-cli-"));
	closeDb();
	db = getDb({ dbPath: path.join(tmpDir, "db.sqlite") });
	cli = new CommentsCli(db);
});

afterEach(async () => {
	closeDb();
	await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeInput(overrides: Partial<CreateCommentThreadBody> = {}): CreateCommentThreadBody {
	return {
		filePath: "src/foo.ts",
		side: "additions",
		startLine: 5,
		endLine: 10,
		body: "Rename this helper",
		...overrides,
	};
}

/** A thread the human left through the browser (user-authored root comment). */
function seedUserThread(scopeKey = SCOPE_KEY, overrides: Partial<CreateCommentThreadBody> = {}) {
	return new LocalCommentThreadStore(db).create(scopeKey, makeInput(overrides), "user").thread;
}

describe("comments CLI — reading threads", () => {
	it("lists open threads for the scope by default and hides other scopes", () => {
		const open = seedUserThread();
		seedUserThread(OTHER_SCOPE_KEY);
		const resolved = seedUserThread(SCOPE_KEY, { body: "Already handled" });
		cli.resolve(resolved.id);

		expect(cli.list(SCOPE_KEY, "open").map((t) => t.id)).toEqual([open.id]);
		expect(cli.list(SCOPE_KEY, "resolved").map((t) => t.id)).toEqual([resolved.id]);
		expect(cli.list(SCOPE_KEY, "all").map((t) => t.id)).toEqual([open.id, resolved.id]);
	});

	it("shows a thread by full ID with its status and comments", () => {
		const thread = seedUserThread();

		const shown = cli.show(thread.id);

		expect(shown).toMatchObject({
			id: thread.id,
			status: "open",
			filePath: "src/foo.ts",
			side: "additions",
			startLine: 5,
			endLine: 10,
			resolvedAt: null,
		});
		expect(shown.comments).toHaveLength(1);
		expect(shown.comments[0]).toMatchObject({ body: "Rename this helper", authorType: "user" });
	});
});

describe("comments CLI — thread ID prefixes", () => {
	it("resolves an unambiguous prefix", () => {
		const thread = seedUserThread();

		expect(cli.show(thread.id.slice(0, 6)).id).toBe(thread.id);
	});

	it("rejects prefixes shorter than six characters", () => {
		const thread = seedUserThread();

		expect(() => cli.show(thread.id.slice(0, 5))).toThrow(/too short/);
	});

	it("errors clearly when nothing matches", () => {
		expect(() => cli.show("zzzzzz-nope")).toThrow('No comment thread matches "zzzzzz-nope"');
	});

	it("errors and lists candidates when a prefix is ambiguous", () => {
		for (const id of ["abcdef-first", "abcdef-second"]) {
			db.insert(commentThread)
				.values({
					id,
					scopeKey: SCOPE_KEY,
					filePath: "src/foo.ts",
					side: "additions",
					startLine: 1,
					endLine: 1,
				})
				.run();
		}

		expect(() => cli.show("abcdef")).toThrow(
			'Thread ID "abcdef" is ambiguous — it matches 2 threads: abcdef-first, abcdef-second. Use a longer prefix.',
		);
	});
});

describe("comments CLI — acting on threads", () => {
	it("replies as the agent and returns the updated thread", () => {
		const thread = seedUserThread();

		const { thread: updated, comment } = cli.reply(thread.id, "Which name did you have in mind?");

		expect(comment).toMatchObject({
			body: "Which name did you have in mind?",
			authorType: "agent",
		});
		expect(updated.comments.map((c) => c.authorType)).toEqual(["user", "agent"]);
		expect(updated.status).toBe("open");
	});

	it("resolves with a closing reply, then reopens", () => {
		const thread = seedUserThread();

		const resolved = cli.resolve(thread.id, "Fixed: renamed the helper and added a test");
		expect(resolved.status).toBe("resolved");
		expect(resolved.resolvedAt).not.toBeNull();
		expect(resolved.comments.at(-1)).toMatchObject({
			body: "Fixed: renamed the helper and added a test",
			authorType: "agent",
		});

		const reopened = cli.reopen(thread.id);
		expect(reopened.status).toBe("open");
		expect(reopened.resolvedAt).toBeNull();
	});

	it("resolves without adding a reply when no body is given", () => {
		const thread = seedUserThread();

		const resolved = cli.resolve(thread.id);

		expect(resolved.comments).toHaveLength(1);
		expect(resolved.status).toBe("resolved");
	});

	it("creates an agent-authored thread in the scope", () => {
		const created = cli.create(
			SCOPE_KEY,
			makeInput({ body: "Consider extracting this", endLine: 5 }),
		);

		expect(created).toMatchObject({ status: "open", startLine: 5, endLine: 5 });
		expect(created.comments[0]).toMatchObject({
			body: "Consider extracting this",
			authorType: "agent",
		});
		expect(cli.list(SCOPE_KEY, "open").map((t) => t.id)).toEqual([created.id]);
	});
});

describe("comments CLI — human-readable listing", () => {
	it("formats a short ID, status, anchor, and a one-line preview of the root comment", () => {
		const thread = cli.create(SCOPE_KEY, makeInput({ body: "First line\n  second line" }));

		expect(formatThreadLine(thread)).toBe(
			`${thread.id.slice(0, 8)}  open      src/foo.ts:5-10  First line second line`,
		);
	});

	it("truncates long previews with an ellipsis", () => {
		const thread = cli.create(SCOPE_KEY, makeInput({ body: "x".repeat(200) }));

		const preview = formatThreadLine(thread).split("  ").at(-1);

		expect(preview).toHaveLength(72);
		expect(preview?.endsWith("…")).toBe(true);
	});
});

describe("comments CLI — argument validation", () => {
	it.each([
		["create", "--file", "src/foo.ts", "--line", "3", "--body", "   "],
		["reply", "abcdef-thread", "--body", "\n\t"],
		["resolve", "abcdef-thread", "--body", " "],
	])("rejects a whitespace-only --body for %s before touching git or the database", async (...argv) => {
		await expect(commentsCommand().parseAsync(argv, { from: "user" })).rejects.toThrow(
			"--body must not be empty.",
		);
	});
});
