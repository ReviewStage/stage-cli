import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { closeDb, getDb, type StageDb } from "../db/client.js";
import { chapterRun, comment, commentThread } from "../db/schema/index.js";
import { commentRoutes } from "../routes/comments.js";
import { reviewRoutes } from "../routes/review.js";
import { deriveScopeKey } from "../runs/scope-key.js";
import { SCOPE_KIND, WORKING_TREE_REF } from "../schema.js";
import { LOOPBACK_HOST, type ServerHandle, startServer } from "../server.js";

export const BASE = "b".repeat(40);
export const HEAD = "a".repeat(40);
export const MERGE_BASE = "c".repeat(40);
export const SCOPE_KEY = deriveScopeKey({
	scopeKind: SCOPE_KIND.COMMITTED,
	workingTreeRef: null,
	baseSha: BASE,
	headSha: HEAD,
	mergeBaseSha: MERGE_BASE,
});
export const GITHUB_ORIGIN = "git@github.com:owner/repo.git";

const submittedThread = {
	id: "THREAD_sub",
	isResolved: false,
	viewerCanResolve: true,
	viewerCanUnresolve: true,
	viewerCanReply: true,
	path: "src/foo.ts",
	line: 10,
	startLine: null,
	diffSide: "RIGHT",
	startDiffSide: null,
	comments: {
		pageInfo: { hasNextPage: false, endCursor: null },
		nodes: [
			{
				id: "COMMENT_sub",
				url: "https://github.com/owner/repo/pull/5#discussion_r1",
				body: "Submitted comment",
				bodyHTML: "<p>Submitted comment</p>",
				createdAt: "2026-01-01T00:00:00Z",
				author: { login: "octocat", avatarUrl: "https://x/o.png" },
				pullRequestReview: { state: "COMMENTED" },
			},
		],
	},
};

const pendingThread = {
	id: "THREAD_pending",
	isResolved: false,
	viewerCanResolve: true,
	viewerCanUnresolve: true,
	viewerCanReply: true,
	path: "src/bar.ts",
	line: 4,
	startLine: null,
	diffSide: "LEFT",
	startDiffSide: null,
	comments: {
		pageInfo: { hasNextPage: false, endCursor: null },
		nodes: [
			{
				id: "COMMENT_pending",
				url: "https://github.com/owner/repo/pull/5#discussion_r2",
				body: "Draft comment",
				bodyHTML: "<p>Draft comment</p>",
				createdAt: "2026-01-02T00:00:00Z",
				author: { login: "octocat", avatarUrl: "https://x/o.png" },
				pullRequestReview: { state: "PENDING" },
			},
		],
	},
};

function makePromotionThread(rootState: "PENDING" | "COMMENTED") {
	return {
		id: "THREAD_new",
		isResolved: false,
		viewerCanResolve: true,
		viewerCanUnresolve: true,
		viewerCanReply: true,
		path: "src/foo.ts",
		line: 3,
		startLine: null,
		diffSide: "RIGHT",
		startDiffSide: null,
		comments: {
			pageInfo: { hasNextPage: false, endCursor: null },
			nodes: [
				{
					id: "COMMENT_new",
					url: "https://github.com/owner/repo/pull/5#discussion_r3",
					body: "Local note",
					bodyHTML: "<p>Local note</p>",
					createdAt: "2026-01-03T00:00:00Z",
					author: { login: "octocat", avatarUrl: "https://x/o.png" },
					pullRequestReview: { state: rootState },
				},
			],
		},
	};
}

function makeReview(
	threads: unknown[],
	pendingReviewId: string | null,
	pendingReviewBody = "",
	options: {
		state?: "OPEN" | "CLOSED" | "MERGED";
		headRefOid?: string;
		viewerDidAuthor?: boolean;
	} = {},
): unknown {
	return {
		data: {
			viewer: { login: "octocat" },
			repository: {
				pullRequest: {
					id: "PR_node",
					state: options.state ?? "OPEN",
					viewerDidAuthor: options.viewerDidAuthor ?? false,
					headRefOid: options.headRefOid ?? HEAD,
					baseRefOid: BASE,
					reviews: {
						nodes:
							pendingReviewId === null ? [] : [{ id: pendingReviewId, body: pendingReviewBody }],
					},
					reviewThreads: {
						pageInfo: { hasNextPage: false, endCursor: null },
						nodes: threads,
					},
				},
			},
		},
	};
}

export const REVIEW_QUERY_RESULT = makeReview([submittedThread, pendingThread], "REVIEW_pending");
export const EMPTY_REVIEW = makeReview([], null);

export function makeSummaryOnlyPendingReview(): unknown {
	return makeReview([], "REVIEW_pending", "Existing draft summary");
}

export function makeClosedReview(): unknown {
	return makeReview([submittedThread, pendingThread], "REVIEW_pending", "", {
		state: "CLOSED",
	});
}

export function makeOwnPullRequestReview(): unknown {
	return makeReview([pendingThread], "REVIEW_pending", "", {
		viewerDidAuthor: true,
	});
}

export function makeResolvedThreadReview(): unknown {
	return makeReview([{ ...submittedThread, isResolved: true }], null);
}

export function makeUnresolvableReview(): unknown {
	return makeReview(
		[
			{
				...submittedThread,
				viewerCanResolve: false,
			},
		],
		null,
	);
}

export function makeUnreplyableReview(): unknown {
	return makeReview(
		[
			{
				...submittedThread,
				viewerCanReply: false,
			},
		],
		null,
	);
}

export function makeCrossSideRangeReview(): unknown {
	return makeReview(
		[
			{
				...submittedThread,
				startLine: 8,
				startDiffSide: "LEFT",
				diffSide: "RIGHT",
			},
		],
		null,
	);
}

export function makeAnchorlessPendingReview(): unknown {
	return makeReview(
		[
			{
				id: "THREAD_outdated",
				isResolved: false,
				viewerCanResolve: true,
				viewerCanUnresolve: true,
				viewerCanReply: true,
				path: "src/foo.ts",
				line: null,
				startLine: null,
				diffSide: "RIGHT",
				startDiffSide: null,
				comments: {
					pageInfo: { hasNextPage: false, endCursor: null },
					nodes: [
						{
							id: "COMMENT_outdated",
							url: "https://github.com/owner/repo/pull/5#d9",
							body: "Outdated draft",
							bodyHTML: "<p>Outdated draft</p>",
							createdAt: "2026-01-03T00:00:00Z",
							author: { login: "octocat", avatarUrl: "https://x/o.png" },
							pullRequestReview: { state: "PENDING" },
						},
					],
				},
			},
		],
		"REVIEW_pending",
	);
}

interface GhShimOptions {
	addThreadDelayMs?: number;
	discoveredPullRequest?: boolean;
	failAddThread?: boolean;
	addConcurrentPendingCommentOnThreadFailure?: boolean;
	failAddReply?: boolean;
	failDiscardAfterWrite?: boolean;
	mergeBaseOid?: string;
	noPullRequest?: boolean;
	persistCreatedReview?: boolean;
	reviewQueryDelayMs?: number;
}

interface InsertRunOptions {
	originUrl?: string | null;
	committed?: boolean;
	headSha?: string;
	prNumber?: number | null;
	repoRoot?: string;
}

interface SeedThreadOptions {
	withReply?: boolean;
	resolved?: boolean;
}

export class ReviewRouteHarness {
	private tmpDir = "";
	private dbPath = "";
	private webDist = "";
	private repoRoot = "";
	private binDir = "";
	private prNumber = 0;
	private originalPath: string | undefined;
	private readonly handles: ServerHandle[] = [];

	get db(): StageDb {
		return getDb({ dbPath: this.dbPath });
	}

	get pullRequestNumber(): number {
		return this.prNumber;
	}

	async setup(): Promise<void> {
		this.tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage-cli-review-"));
		this.dbPath = path.join(this.tmpDir, "db.sqlite");
		this.webDist = path.join(this.tmpDir, "web-dist");
		this.repoRoot = path.join(this.tmpDir, "repo");
		this.binDir = path.join(this.tmpDir, "bin");
		this.prNumber = Number.parseInt(
			createHash("sha256").update(this.tmpDir).digest("hex").slice(0, 7),
			16,
		);
		await fs.mkdir(this.webDist);
		await fs.writeFile(path.join(this.webDist, "index.html"), "<html></html>");
		await fs.mkdir(this.repoRoot);
		await fs.mkdir(this.binDir);
		this.originalPath = process.env.PATH;
		process.env.PATH = `${this.binDir}${path.delimiter}${this.originalPath ?? ""}`;
		closeDb();
	}

	async teardown(): Promise<void> {
		while (this.handles.length > 0) {
			const handle = this.handles.pop();
			if (handle) await handle.close();
		}
		closeDb();
		process.env.PATH = this.originalPath;
		await fs.rm(this.tmpDir, { recursive: true, force: true });
	}

	async writeGhShim(reviewResult: unknown, options: GhShimOptions = {}): Promise<void> {
		const reviewPath = path.join(this.tmpDir, "review.json");
		await fs.writeFile(reviewPath, JSON.stringify(reviewResult));
		const promotionThread = makePromotionThread("PENDING");
		const shim = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const inputText = args.includes("--input") ? fs.readFileSync(0, "utf8") : "";
const input = inputText ? JSON.parse(inputText) : null;
const query = (args.find((a) => a.startsWith("query=")) || input?.query || "");
const inputFields = input?.variables || input || {};
const fields = inputText
  ? Object.entries(inputFields).map(([key, value]) => key + "=" + value).join(" ")
  : args.filter((a) => !a.startsWith("query=") && a !== "-f" && a !== "-F" && a !== "api" && a !== "graphql").join(" ");
const log = ${JSON.stringify(path.join(this.tmpDir, "gh-log.txt"))};
const argvLog = ${JSON.stringify(path.join(this.tmpDir, "gh-argv-log.txt"))};
const reviewPath = ${JSON.stringify(reviewPath)};
fs.appendFileSync(argvLog, JSON.stringify(args) + "\\n");
function emit(o) { process.stdout.write(JSON.stringify(o)); }
function sleep(ms) { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
if (args.some((arg) => arg.includes("/compare/"))) {
  const mergeBaseOid = ${JSON.stringify(options.mergeBaseOid ?? MERGE_BASE)};
  if (args.includes("--jq")) process.stdout.write(mergeBaseOid + "\\n");
  else emit({ merge_base_commit: { sha: mergeBaseOid } });
} else if (args[0] === "pr" && args[1] === "view") {
  if (${options.noPullRequest ? "true" : "false"}) {
    process.stderr.write("no pull requests found for branch \\"feature\\"\\n");
    process.exit(1);
  }
  emit(${options.discoveredPullRequest ? `{ number: 5, title: "Other branch", body: "", url: "https://github.com/owner/repo/pull/5", state: "OPEN", isDraft: false, mergedAt: null, createdAt: "2026-01-01T00:00:00Z", author: { login: "octocat" }, headRefName: "other", headRefOid: ${JSON.stringify(HEAD)}, baseRefName: "main" }` : "{}"});
} else if (
  args.includes("--method") &&
  args.some((arg) => arg.includes("/pulls/") && arg.endsWith("/comments"))
) {
  fs.appendFileSync(log, "create-immediate-comment " + fields.replaceAll("\\n", "\\\\n") + "\\n");
  emit({ id: 123, node_id: "COMMENT_immediate" });
} else if (query.includes("query GetReview")) {
  sleep(${options.reviewQueryDelayMs ?? 0});
  const commentFields = query.slice(query.indexOf("comments(first:"), query.indexOf("author {"));
  const illegalCommentField = ["databaseId", "diffSide", "startDiffSide"].find((field) => commentFields.includes(field));
  if (illegalCommentField) {
    process.stderr.write("gh: PullRequestReviewComment has no field " + illegalCommentField + "\\n");
    process.exit(1);
  }
	const review = JSON.parse(fs.readFileSync(reviewPath, "utf8"));
	  emit(review);
} else if (query.includes("mutation CreatePendingReview")) {
  fs.appendFileSync(log, "create-review " + fields + "\\n");
  if (${options.persistCreatedReview ? "true" : "false"}) {
    const review = JSON.parse(fs.readFileSync(reviewPath, "utf8"));
    review.data.repository.pullRequest.reviews.nodes = [{ id: "REVIEW_new", body: "" }];
    fs.writeFileSync(reviewPath, JSON.stringify(review));
  }
  emit({ data: { addPullRequestReview: { pullRequestReview: { id: "REVIEW_new" } } } });
} else if (query.includes("mutation AddReviewThread")) {
  fs.appendFileSync(log, "add-thread " + fields + "\\n");
  sleep(${options.addThreadDelayMs ?? 0});
  if (${options.failAddThread ? "true" : "false"}) {
    if (${options.addConcurrentPendingCommentOnThreadFailure ? "true" : "false"}) {
      const review = JSON.parse(fs.readFileSync(reviewPath, "utf8"));
      review.data.repository.pullRequest.reviewThreads.nodes.push(${JSON.stringify(pendingThread)});
      fs.writeFileSync(reviewPath, JSON.stringify(review));
    }
    process.stderr.write("gh: line not in diff\\n");
    process.exit(1);
	  }
	  const review = JSON.parse(fs.readFileSync(reviewPath, "utf8"));
	  const createdThread = ${JSON.stringify(promotionThread)};
	  createdThread.comments.nodes[0].body = inputFields.body;
	  review.data.repository.pullRequest.reviewThreads.nodes.push(createdThread);
	  fs.writeFileSync(reviewPath, JSON.stringify(review));
	  emit({ data: { addPullRequestReviewThread: { thread: { id: "THREAD_new", viewerCanResolve: true, comments: { nodes: [{ id: "COMMENT_new" }] } } } } });
} else if (query.includes("mutation ResolveThread") || query.includes("mutation UnresolveThread")) {
  const resolving = query.includes("mutation ResolveThread");
  fs.appendFileSync(log, resolving ? "resolve-thread\\n" : "unresolve-thread\\n");
  const responseField = resolving ? "resolveReviewThread" : "unresolveReviewThread";
  emit({ data: { [responseField]: { thread: { id: "THREAD_new" } } } });
} else if (query.includes("mutation DeleteReviewComment")) {
  fs.appendFileSync(log, "delete-comment\\n");
  emit({ data: { deletePullRequestReviewComment: { pullRequestReviewComment: { id: "COMMENT_new" } } } });
} else if (query.includes("mutation UpdateReviewComment")) {
  fs.appendFileSync(log, "edit-comment " + fields + "\\n");
  emit({ data: { updatePullRequestReviewComment: { pullRequestReviewComment: { id: "COMMENT_new" } } } });
} else if (query.includes("mutation DiscardReview")) {
  fs.appendFileSync(log, "discard-review\\n");
  if (${options.failDiscardAfterWrite ? "true" : "false"}) {
	const review = JSON.parse(fs.readFileSync(reviewPath, "utf8"));
	review.data.repository.pullRequest.reviews.nodes = [];
	review.data.repository.pullRequest.reviewThreads.nodes = review.data.repository.pullRequest.reviewThreads.nodes.flatMap((thread) => {
	  thread.comments.nodes = thread.comments.nodes.filter((comment) => comment.pullRequestReview.state !== "PENDING");
	  return thread.comments.nodes.length === 0 ? [] : [thread];
	});
	fs.writeFileSync(reviewPath, JSON.stringify(review));
	process.stderr.write("gh: connection closed after discard mutation\\n");
	process.exit(1);
  }
  emit({ data: { deletePullRequestReview: { pullRequestReview: { id: "REVIEW_new" } } } });
} else if (query.includes("mutation AddReviewReply")) {
  fs.appendFileSync(log, "reply\\n");
  if (${options.failAddReply ? "true" : "false"}) { process.stderr.write("gh: reply failed\\n"); process.exit(1); }
  emit({ data: { addPullRequestReviewThreadReply: { comment: { id: "C" } } } });
} else if (query.includes("mutation SubmitReview")) {
  fs.appendFileSync(log, "submit " + fields + "\\n");
  emit({ data: { submitPullRequestReview: { pullRequestReview: { id: "R" } } } });
} else {
  emit({ data: {} });
}
`;
		await fs.writeFile(path.join(this.binDir, "gh"), shim);
		await fs.chmod(path.join(this.binDir, "gh"), 0o755);
	}

	async writeFailingGhShim(): Promise<void> {
		await fs.writeFile(
			path.join(this.binDir, "gh"),
			"#!/bin/sh\nprintf 'gh: authentication required\\n' >&2\nexit 1\n",
		);
		await fs.chmod(path.join(this.binDir, "gh"), 0o755);
	}

	insertRun(options: InsertRunOptions = {}): string {
		const originUrl = options.originUrl === undefined ? GITHUB_ORIGIN : options.originUrl;
		const committed = options.committed !== false;
		const [row] = this.db
			.insert(chapterRun)
			.values({
				repoRoot: options.repoRoot ?? this.repoRoot,
				originUrl,
				prNumber: options.prNumber === undefined ? this.prNumber : options.prNumber,
				scopeKind: committed ? SCOPE_KIND.COMMITTED : SCOPE_KIND.WORKING_TREE,
				workingTreeRef: committed ? null : WORKING_TREE_REF.WORK,
				baseSha: BASE,
				headSha: options.headSha ?? HEAD,
				mergeBaseSha: MERGE_BASE,
				generatedAt: new Date(),
			})
			.returning({ id: chapterRun.id })
			.all();
		if (!row) throw new Error("seed: chapter_run insert returned no row");
		return row.id;
	}

	seedLocalThread(options: SeedThreadOptions = {}): string {
		const [thread] = this.db
			.insert(commentThread)
			.values({
				scopeKey: SCOPE_KEY,
				filePath: "src/foo.ts",
				side: "additions",
				startLine: 3,
				endLine: 3,
				resolvedAt: options.resolved ? new Date() : null,
			})
			.returning({ id: commentThread.id })
			.all();
		if (!thread) throw new Error("seed: thread insert returned no row");
		this.db
			.insert(comment)
			.values({ threadId: thread.id, body: options.withReply ? "Root" : "Local note" })
			.run();
		if (options.withReply) {
			this.db.insert(comment).values({ threadId: thread.id, body: "Reply" }).run();
		}
		return thread.id;
	}

	async start(): Promise<number> {
		const handle = await startServer({
			webDistPath: this.webDist,
			routes: [...commentRoutes(this.db), ...reviewRoutes(this.db)],
		});
		this.handles.push(handle);
		return handle.port;
	}

	request(
		port: number,
		method: string,
		requestPath: string,
		body?: unknown,
		headers: Record<string, string> = {},
	): Promise<{ status: number; body: string }> {
		return new Promise((resolve, reject) => {
			const payload = body === undefined ? undefined : JSON.stringify(body);
			const req = http.request(
				{
					hostname: LOOPBACK_HOST,
					port,
					method,
					path: requestPath,
					agent: false,
					headers:
						payload === undefined
							? headers
							: {
									...headers,
									"Content-Type": "application/json",
									"Content-Length": Buffer.byteLength(payload),
								},
				},
				(res) => {
					const chunks: Buffer[] = [];
					res.on("data", (chunk: Buffer) => chunks.push(chunk));
					res.on("end", () =>
						resolve({
							status: res.statusCode ?? 0,
							body: Buffer.concat(chunks).toString("utf8"),
						}),
					);
				},
			);
			req.on("error", reject);
			req.end(payload);
		});
	}

	async logLines(): Promise<string[]> {
		const text = await fs.readFile(path.join(this.tmpDir, "gh-log.txt"), "utf8").catch(() => "");
		return text.split("\n");
	}

	async ghArgvCalls(): Promise<string[][]> {
		const text = await fs
			.readFile(path.join(this.tmpDir, "gh-argv-log.txt"), "utf8")
			.catch(() => "");
		return text
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as string[]);
	}
}
