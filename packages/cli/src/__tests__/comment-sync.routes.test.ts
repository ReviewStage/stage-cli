import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { PullCommentsResult, PushCommentsResult } from "@stagereview/types/comments";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../db/client.js";
import { chapterRun, comment, commentThread } from "../db/schema/index.js";
import { commentRoutes } from "../routes/comments.js";
import { SCOPE_KIND, WORKING_TREE_REF } from "../schema.js";
import { LOOPBACK_HOST, type ServerHandle, startServer } from "../server.js";

let tmpDir: string;
let dbPath: string;
let webDist: string;
let repoRoot: string;
let binDir: string;
let originalPath: string | undefined;
const handles: ServerHandle[] = [];

const HEAD_SHA = "a".repeat(40);
const GITHUB_ORIGIN = "git@github.com:owner/repo.git";

// REST review comments the fake `gh` returns for a pull (one root + one reply).
const REVIEW_COMMENTS = [
	[
		{
			id: 101,
			in_reply_to_id: null,
			path: "src/foo.ts",
			line: 10,
			start_line: 5,
			side: "RIGHT",
			body: "Root comment",
			created_at: "2026-01-01T00:00:00Z",
			user: { login: "octocat", avatar_url: "https://example.com/octocat.png", type: "User" },
		},
		{
			id: 102,
			in_reply_to_id: 101,
			path: "src/foo.ts",
			line: 10,
			start_line: null,
			side: "RIGHT",
			body: "A reply",
			created_at: "2026-01-02T00:00:00Z",
			user: { login: "hubot", avatar_url: "https://example.com/hubot.png", type: "Bot" },
		},
	],
];

// `gh`/`git` shims that route on argv and emit canned JSON, so the sync paths run
// end-to-end without network or a real repo. Infrastructure fakes, not mocks.
async function writeShims(opts: { gitHead: string; gitStatus: string }): Promise<void> {
	const ghFixture = {
		pr: {
			number: 5,
			title: "Add foo",
			body: "",
			url: "https://github.com/owner/repo/pull/5",
			state: "OPEN",
			isDraft: false,
			mergedAt: null,
			createdAt: "2026-01-01T00:00:00Z",
			author: { login: "octocat", is_bot: false },
			headRefName: "feature",
			headRefOid: HEAD_SHA,
			baseRefName: "main",
		},
		restPr: {
			user: { login: "octocat", avatar_url: "https://example.com/octocat.png", type: "User" },
			requested_reviewers: [],
		},
		graphql: {
			data: {
				repository: {
					pullRequest: {
						reviewThreads: {
							pageInfo: { hasNextPage: false, endCursor: null },
							nodes: [],
						},
					},
				},
			},
		},
		comments: REVIEW_COMMENTS,
	};
	await fs.writeFile(path.join(tmpDir, "gh-fixture.json"), JSON.stringify(ghFixture));

	const ghShim = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const fx = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(tmpDir, "gh-fixture.json"))}, "utf8"));
const log = ${JSON.stringify(path.join(tmpDir, "gh-log.txt"))};
const counterFile = ${JSON.stringify(path.join(tmpDir, "gh-counter.txt"))};
function nextId() {
  let n = 1000;
  try { n = parseInt(fs.readFileSync(counterFile, "utf8"), 10); } catch {}
  n += 1;
  fs.writeFileSync(counterFile, String(n));
  return n;
}
if (args[0] === "pr" && args[1] === "view") {
  process.stdout.write(JSON.stringify(fx.pr));
} else if (args[0] === "api" && args[1] === "graphql") {
  process.stdout.write(JSON.stringify(fx.graphql));
} else if (args[0] === "api") {
  const endpoint = args[1];
  const isPost = args.includes("POST");
  if (/\\/comments$/.test(endpoint) && isPost) {
    fs.appendFileSync(log, "create " + args.join(" ") + "\\n");
    process.stdout.write(JSON.stringify({ id: nextId() }));
  } else if (/\\/replies$/.test(endpoint) && isPost) {
    fs.appendFileSync(log, "reply " + args.join(" ") + "\\n");
    process.stdout.write(JSON.stringify({ id: nextId() }));
  } else if (/\\/comments$/.test(endpoint)) {
    process.stdout.write(JSON.stringify(fx.comments));
  } else if (/\\/pulls\\/\\d+$/.test(endpoint)) {
    process.stdout.write(JSON.stringify(fx.restPr));
  } else {
    process.stdout.write("{}");
  }
}
`;
	await fs.writeFile(path.join(binDir, "gh"), ghShim);
	await fs.chmod(path.join(binDir, "gh"), 0o755);

	const gitShim = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("rev-parse")) process.stdout.write(${JSON.stringify(opts.gitHead)});
else if (args.includes("status")) process.stdout.write(${JSON.stringify(opts.gitStatus)});
`;
	await fs.writeFile(path.join(binDir, "git"), gitShim);
	await fs.chmod(path.join(binDir, "git"), 0o755);
}

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage-cli-sync-"));
	dbPath = path.join(tmpDir, "db.sqlite");
	webDist = path.join(tmpDir, "web-dist");
	repoRoot = path.join(tmpDir, "repo");
	binDir = path.join(tmpDir, "bin");
	await fs.mkdir(webDist);
	await fs.writeFile(path.join(webDist, "index.html"), "<html></html>");
	await fs.mkdir(repoRoot);
	await fs.mkdir(binDir);
	originalPath = process.env.PATH;
	// Shim dir first so `gh`/`git` resolve to the fakes.
	process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ""}`;
	closeDb();
});

afterEach(async () => {
	while (handles.length > 0) {
		const h = handles.pop();
		if (h) await h.close();
	}
	closeDb();
	process.env.PATH = originalPath;
	await fs.rm(tmpDir, { recursive: true, force: true });
});

function insertRun(scopeKind: string = SCOPE_KIND.COMMITTED): string {
	const db = getDb({ dbPath });
	const [row] = db
		.insert(chapterRun)
		.values({
			repoRoot,
			originUrl: GITHUB_ORIGIN,
			scopeKind:
				scopeKind === SCOPE_KIND.COMMITTED ? SCOPE_KIND.COMMITTED : SCOPE_KIND.WORKING_TREE,
			workingTreeRef: scopeKind === SCOPE_KIND.COMMITTED ? null : WORKING_TREE_REF.WORK,
			baseSha: "b".repeat(40),
			headSha: HEAD_SHA,
			mergeBaseSha: "c".repeat(40),
			generatedAt: new Date(),
		})
		.returning({ id: chapterRun.id })
		.all();
	if (!row) throw new Error("seed: chapter_run insert returned no row");
	return row.id;
}

function seedLocalThread(): void {
	const db = getDb({ dbPath });
	const scopeKey = `committed:${"b".repeat(40)}:${HEAD_SHA}:${"c".repeat(40)}`;
	const [thread] = db
		.insert(commentThread)
		.values({ scopeKey, filePath: "src/foo.ts", side: "additions", startLine: 3, endLine: 3 })
		.returning({ id: commentThread.id })
		.all();
	if (!thread) throw new Error("seed: thread insert returned no row");
	db.insert(comment).values({ threadId: thread.id, body: "Push me" }).run();
}

async function start(): Promise<number> {
	const db = getDb({ dbPath });
	const handle = await startServer({ webDistPath: webDist, routes: commentRoutes(db) });
	handles.push(handle);
	return handle.port;
}

function post(port: number, p: string): Promise<{ status: number; body: string }> {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{ hostname: LOOPBACK_HOST, port, method: "POST", path: p, agent: false },
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (c: Buffer) => chunks.push(c));
				res.on("end", () =>
					resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
				);
			},
		);
		req.on("error", reject);
		req.end();
	});
}

describe("comment sync API — pull", () => {
	it("imports a PR's review comments, then is idempotent on re-pull", async () => {
		await writeShims({ gitHead: HEAD_SHA, gitStatus: "" });
		const runId = insertRun();
		const port = await start();

		const first = await post(port, `/api/runs/${runId}/comment-sync/pull`);
		expect(first.status).toBe(200);
		expect(JSON.parse(first.body) as PullCommentsResult).toEqual({ pulled: 2, skipped: 0 });

		const db = getDb({ dbPath });
		const rows = db.select().from(comment).all();
		expect(rows).toHaveLength(2);
		const root = rows.find((r) => r.githubCommentId === 101);
		expect(root?.authorId).toBe("octocat");
		expect(root?.authorAvatarUrl).toBe("https://example.com/octocat.png");
		expect(db.select().from(commentThread).all()).toHaveLength(1);

		const second = await post(port, `/api/runs/${runId}/comment-sync/pull`);
		expect(JSON.parse(second.body) as PullCommentsResult).toEqual({ pulled: 0, skipped: 2 });
		expect(db.select().from(comment).all()).toHaveLength(2);
	});
});

describe("comment sync API — push guardrails", () => {
	it("rejects pushing comments on a working-tree scope", async () => {
		await writeShims({ gitHead: HEAD_SHA, gitStatus: "" });
		const runId = insertRun(SCOPE_KIND.WORKING_TREE);
		const res = await post(await start(), `/api/runs/${runId}/comment-sync/push`);
		expect(res.status).toBe(409);
		expect(JSON.parse(res.body).error).toMatch(/committed diff/i);
	});

	it("rejects pushing with a dirty working tree", async () => {
		await writeShims({ gitHead: HEAD_SHA, gitStatus: " M src/foo.ts" });
		const runId = insertRun();
		const res = await post(await start(), `/api/runs/${runId}/comment-sync/push`);
		expect(res.status).toBe(409);
		expect(JSON.parse(res.body).error).toMatch(/uncommitted changes/i);
	});

	it("rejects pushing when local HEAD doesn't match the PR head", async () => {
		await writeShims({ gitHead: "f".repeat(40), gitStatus: "" });
		const runId = insertRun();
		const res = await post(await start(), `/api/runs/${runId}/comment-sync/push`);
		expect(res.status).toBe(409);
		expect(JSON.parse(res.body).error).toMatch(/HEAD doesn't match/i);
	});
});

describe("comment sync API — push", () => {
	it("creates a review comment for a local thread, recording its GitHub id, then skips on re-push", async () => {
		await writeShims({ gitHead: HEAD_SHA, gitStatus: "" });
		const runId = insertRun();
		seedLocalThread();
		const port = await start();

		const first = await post(port, `/api/runs/${runId}/comment-sync/push`);
		expect(first.status).toBe(200);
		const firstResult = JSON.parse(first.body) as PushCommentsResult;
		expect(firstResult.pushed).toBe(1);
		expect(firstResult.skipped).toBe(0);
		expect(firstResult.failed).toEqual([]);

		const db = getDb({ dbPath });
		const [row] = db.select().from(comment).all();
		expect(row?.githubCommentId).toBe(1001);

		const second = await post(port, `/api/runs/${runId}/comment-sync/push`);
		const secondResult = JSON.parse(second.body) as PushCommentsResult;
		expect(secondResult).toEqual({ pushed: 0, skipped: 1, failed: [] });

		const log = await fs.readFile(path.join(tmpDir, "gh-log.txt"), "utf8");
		expect(log.split("\n").filter((l) => l.startsWith("create"))).toHaveLength(1);
	});
});
