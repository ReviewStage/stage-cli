import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { ReviewResponse } from "@stagereview/types/review";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../db/client.js";
import { chapterRun, comment, commentThread } from "../db/schema/index.js";
import { reviewRoutes } from "../routes/review.js";
import { SCOPE_KIND } from "../schema.js";
import { LOOPBACK_HOST, type ServerHandle, startServer } from "../server.js";

let tmpDir: string;
let dbPath: string;
let webDist: string;
let repoRoot: string;
let binDir: string;
let originalPath: string | undefined;
const handles: ServerHandle[] = [];

const BASE = "b".repeat(40);
const HEAD = "a".repeat(40);
const MERGE_BASE = "c".repeat(40);
const SCOPE_KEY = `committed:${BASE}:${HEAD}:${MERGE_BASE}`;
const GITHUB_ORIGIN = "git@github.com:owner/repo.git";

// One submitted thread (comment 1) and one pending thread (comment 2, viewer's draft).
const REVIEW_QUERY_RESULT = {
	data: {
		repository: {
			pullRequest: {
				id: "PR_node",
				reviews: { nodes: [{ id: "REVIEW_pending" }] },
				reviewThreads: {
					pageInfo: { hasNextPage: false, endCursor: null },
					nodes: [
						{
							id: "THREAD_sub",
							isResolved: false,
							comments: {
								nodes: [
									{
										databaseId: 1,
										id: "COMMENT_sub",
										path: "src/foo.ts",
										body: "Submitted comment",
										createdAt: "2026-01-01T00:00:00Z",
										line: 10,
										startLine: null,
										diffSide: "RIGHT",
										startDiffSide: null,
										author: { login: "octocat", avatarUrl: "https://x/o.png" },
										pullRequestReview: { state: "COMMENTED" },
									},
								],
							},
						},
						{
							id: "THREAD_pending",
							isResolved: false,
							comments: {
								nodes: [
									{
										databaseId: 2,
										id: "COMMENT_pending",
										path: "src/bar.ts",
										body: "Draft comment",
										createdAt: "2026-01-02T00:00:00Z",
										line: 4,
										startLine: null,
										diffSide: "LEFT",
										startDiffSide: null,
										author: { login: "octocat", avatarUrl: "https://x/o.png" },
										pullRequestReview: { state: "PENDING" },
									},
								],
							},
						},
					],
				},
			},
		},
	},
};

async function writeGhShim(reviewResult: unknown): Promise<void> {
	await fs.writeFile(path.join(tmpDir, "review.json"), JSON.stringify(reviewResult));
	const shim = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const query = (args.find((a) => a.startsWith("query=")) || "");
// Field args only (the GraphQL query itself is multi-line and would break line-based log parsing).
const fields = args.filter((a) => !a.startsWith("query=") && a !== "-f" && a !== "-F" && a !== "api" && a !== "graphql").join(" ");
const log = ${JSON.stringify(path.join(tmpDir, "gh-log.txt"))};
function emit(o) { process.stdout.write(JSON.stringify(o)); }
if (query.includes("query GetReview")) {
  emit(JSON.parse(fs.readFileSync(${JSON.stringify(path.join(tmpDir, "review.json"))}, "utf8")));
} else if (query.includes("mutation CreatePendingReview")) {
  fs.appendFileSync(log, "create-review\\n");
  emit({ data: { addPullRequestReview: { pullRequestReview: { id: "REVIEW_new" } } } });
} else if (query.includes("mutation AddReviewThread")) {
  fs.appendFileSync(log, "add-thread " + fields + "\\n");
  emit({ data: { addPullRequestReviewThread: { thread: { id: "THREAD_new" } } } });
} else if (query.includes("mutation AddReviewReply")) {
  fs.appendFileSync(log, "reply\\n");
  emit({ data: { addPullRequestReviewThreadReply: { comment: { id: "C" } } } });
} else if (query.includes("mutation SubmitReview")) {
  fs.appendFileSync(log, "submit " + fields + "\\n");
  emit({ data: { submitPullRequestReview: { pullRequestReview: { id: "R" } } } });
} else {
  emit({ data: {} });
}
`;
	await fs.writeFile(path.join(binDir, "gh"), shim);
	await fs.chmod(path.join(binDir, "gh"), 0o755);
}

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage-cli-review-"));
	dbPath = path.join(tmpDir, "db.sqlite");
	webDist = path.join(tmpDir, "web-dist");
	repoRoot = path.join(tmpDir, "repo");
	binDir = path.join(tmpDir, "bin");
	await fs.mkdir(webDist);
	await fs.writeFile(path.join(webDist, "index.html"), "<html></html>");
	await fs.mkdir(repoRoot);
	await fs.mkdir(binDir);
	originalPath = process.env.PATH;
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

function insertRun(originUrl: string | null): string {
	const db = getDb({ dbPath });
	const [row] = db
		.insert(chapterRun)
		.values({
			repoRoot,
			originUrl,
			prNumber: 5,
			scopeKind: SCOPE_KIND.COMMITTED,
			workingTreeRef: null,
			baseSha: BASE,
			headSha: HEAD,
			mergeBaseSha: MERGE_BASE,
			generatedAt: new Date(),
		})
		.returning({ id: chapterRun.id })
		.all();
	if (!row) throw new Error("seed: chapter_run insert returned no row");
	return row.id;
}

function seedLocalThread(): string {
	const db = getDb({ dbPath });
	const [thread] = db
		.insert(commentThread)
		.values({
			scopeKey: SCOPE_KEY,
			filePath: "src/foo.ts",
			side: "additions",
			startLine: 3,
			endLine: 3,
		})
		.returning({ id: commentThread.id })
		.all();
	if (!thread) throw new Error("seed: thread insert returned no row");
	db.insert(comment).values({ threadId: thread.id, body: "Local note" }).run();
	return thread.id;
}

async function start(): Promise<number> {
	const db = getDb({ dbPath });
	const handle = await startServer({ webDistPath: webDist, routes: reviewRoutes(db) });
	handles.push(handle);
	return handle.port;
}

function request(
	port: number,
	method: string,
	p: string,
	body?: unknown,
): Promise<{ status: number; body: string }> {
	return new Promise((resolve, reject) => {
		const payload = body === undefined ? undefined : JSON.stringify(body);
		const req = http.request(
			{
				hostname: LOOPBACK_HOST,
				port,
				method,
				path: p,
				agent: false,
				headers:
					payload === undefined
						? {}
						: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (c: Buffer) => chunks.push(c));
				res.on("end", () =>
					resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
				);
			},
		);
		req.on("error", reject);
		req.end(payload);
	});
}

describe("review API — read", () => {
	it("returns local-only with github:none when there's no GitHub remote", async () => {
		const runId = insertRun(null);
		seedLocalThread();
		const res = await request(await start(), "GET", `/api/runs/${runId}/review`);
		expect(res.status).toBe(200);
		const review = JSON.parse(res.body) as ReviewResponse;
		expect(review.github).toBe("none");
		expect(review.threads).toHaveLength(1);
		expect(review.threads[0]?.source).toBe("local");
		expect(review.threads[0]?.comments[0]?.state).toBe("local");
	});

	it("merges local threads with the PR's pending and submitted GitHub threads", async () => {
		await writeGhShim(REVIEW_QUERY_RESULT);
		const runId = insertRun(GITHUB_ORIGIN);
		seedLocalThread();
		const res = await request(await start(), "GET", `/api/runs/${runId}/review`);
		const review = JSON.parse(res.body) as ReviewResponse;
		expect(review.github).toBe("available");
		expect(review.pendingCommentCount).toBe(1);
		expect(review.hasPendingReview).toBe(true);

		const states = review.threads.map((t) => t.comments[0]?.state).sort();
		expect(states).toEqual(["local", "pending", "submitted"]);
		// LEFT diff side maps to the deletions side locally.
		const pending = review.threads.find((t) => t.comments[0]?.state === "pending");
		expect(pending?.side).toBe("deletions");
	});

	it("reports github:offline when gh fails", async () => {
		// No gh shim on PATH → the review query errors out → offline (local still renders).
		await fs.writeFile(path.join(binDir, "gh"), "#!/bin/sh\nexit 1\n");
		await fs.chmod(path.join(binDir, "gh"), 0o755);
		const runId = insertRun(GITHUB_ORIGIN);
		seedLocalThread();
		const res = await request(await start(), "GET", `/api/runs/${runId}/review`);
		const review = JSON.parse(res.body) as ReviewResponse;
		expect(review.github).toBe("offline");
		expect(review.threads).toHaveLength(1);
	});
});

describe("review API — actions", () => {
	it("promotes a local thread to a pending review comment and removes the local copy", async () => {
		await writeGhShim({
			data: {
				repository: {
					pullRequest: {
						id: "PR_node",
						reviews: { nodes: [] },
						reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
					},
				},
			},
		});
		const runId = insertRun(GITHUB_ORIGIN);
		const localThreadId = seedLocalThread();
		const res = await request(await start(), "POST", `/api/runs/${runId}/review/add`, {
			localThreadId,
		});
		expect(res.status).toBe(200);

		const db = getDb({ dbPath });
		expect(db.select().from(commentThread).all()).toHaveLength(0);
		const lines = (await fs.readFile(path.join(tmpDir, "gh-log.txt"), "utf8")).split("\n");
		expect(lines.filter((l) => l === "create-review")).toHaveLength(1);
		expect(lines.filter((l) => l.startsWith("add-thread"))).toHaveLength(1);
	});

	it("submits the pending review with the chosen event", async () => {
		await writeGhShim(REVIEW_QUERY_RESULT);
		const runId = insertRun(GITHUB_ORIGIN);
		const res = await request(await start(), "POST", `/api/runs/${runId}/review/submit`, {
			event: "APPROVE",
			body: "LGTM",
		});
		expect(res.status).toBe(200);
		const lines = (await fs.readFile(path.join(tmpDir, "gh-log.txt"), "utf8")).split("\n");
		const submit = lines.find((l) => l.startsWith("submit"));
		expect(submit).toContain("event=APPROVE");
	});
});
