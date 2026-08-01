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

function makeReview(
	threads: unknown[],
	pendingReviewId: string | null,
	pendingReviewBody = "",
	options: {
		state?: "OPEN" | "CLOSED" | "MERGED";
		headRefOid?: string;
		pendingReviewCommitOid?: string | null;
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
							pendingReviewId === null
								? []
								: [
										{
											id: pendingReviewId,
											body: pendingReviewBody,
											commit:
												options.pendingReviewCommitOid === null
													? null
													: { oid: options.pendingReviewCommitOid ?? HEAD },
										},
									],
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

export function makeStalePendingReview(): unknown {
	return makeReview([submittedThread, pendingThread], "REVIEW_pending", "", {
		pendingReviewCommitOid: "d".repeat(40),
	});
}

export function makeMissingPendingCommitReview(): unknown {
	return makeReview([submittedThread, pendingThread], "REVIEW_pending", "", {
		pendingReviewCommitOid: null,
	});
}

export function makeOwnPullRequestReview(): unknown {
	return makeReview([pendingThread], "REVIEW_pending", "", {
		viewerDidAuthor: true,
	});
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

export function makeInterruptedPromotionReview(
	promotedReplyBody?: string,
	options: { state?: "OPEN" | "CLOSED" | "MERGED"; headRefOid?: string } = {},
): unknown {
	const root = {
		...pendingThread.comments.nodes[0],
		id: "COMMENT_new",
		body: "Root",
		bodyHTML: "<p>Root</p>",
	};
	return makeReview(
		[
			{
				...pendingThread,
				id: "THREAD_new",
				path: "src/foo.ts",
				line: 3,
				diffSide: "RIGHT",
				comments: {
					...pendingThread.comments,
					nodes:
						promotedReplyBody === undefined
							? [root]
							: [
									root,
									{
										...root,
										id: "COMMENT_reply",
										body: promotedReplyBody,
										bodyHTML: `<p>${promotedReplyBody}</p>`,
									},
								],
				},
			},
		],
		"REVIEW_pending",
		"",
		options,
	);
}

export function makePublishedInterruptedPromotionReview(): unknown {
	const root = {
		...pendingThread.comments.nodes[0],
		id: "COMMENT_new",
		body: "Root",
		bodyHTML: "<p>Root</p>",
		pullRequestReview: { state: "COMMENTED" },
	};
	return makeReview(
		[
			{
				...pendingThread,
				id: "THREAD_new",
				path: "src/foo.ts",
				line: 3,
				diffSide: "RIGHT",
				comments: { ...pendingThread.comments, nodes: [root] },
			},
		],
		null,
	);
}

export function makeInterruptedPromotionReviewWithForeignMatchingReply(): unknown {
	const root = {
		...pendingThread.comments.nodes[0],
		id: "COMMENT_new",
		body: "Root",
		bodyHTML: "<p>Root</p>",
	};
	const foreignReply = {
		...submittedThread.comments.nodes[0],
		id: "COMMENT_foreign",
		body: "Reply",
		bodyHTML: "<p>Reply</p>",
		author: { login: "collaborator", avatarUrl: "https://x/c.png" },
	};
	return makeReview(
		[
			{
				...pendingThread,
				id: "THREAD_new",
				path: "src/foo.ts",
				line: 3,
				diffSide: "RIGHT",
				comments: { ...pendingThread.comments, nodes: [root, foreignReply] },
			},
		],
		"REVIEW_pending",
	);
}

export function makeInterruptedPromotionReviewWithInterleavedViewerReply(): unknown {
	const root = {
		...submittedThread.comments.nodes[0],
		id: "COMMENT_new",
		body: "Root",
	};
	const foreignReply = {
		...root,
		id: "COMMENT_foreign",
		body: "Another participant",
		author: { login: "collaborator", avatarUrl: "https://x/c.png" },
	};
	const viewerReply = {
		...root,
		id: "COMMENT_viewer_reply",
		body: "Reply",
	};
	return makeReview(
		[
			{
				...submittedThread,
				id: "THREAD_new",
				comments: { ...submittedThread.comments, nodes: [root, foreignReply, viewerReply] },
			},
		],
		null,
	);
}

export function makeInterruptedPromotionReviewWithSubmittedReply(): unknown {
	const root = {
		...submittedThread.comments.nodes[0],
		id: "COMMENT_new",
		body: "Root",
		bodyHTML: "<p>Root</p>",
	};
	const reply = {
		...submittedThread.comments.nodes[0],
		id: "COMMENT_reply",
		body: "Reply",
		bodyHTML: "<p>Reply</p>",
	};
	return makeReview(
		[
			{
				...submittedThread,
				id: "THREAD_new",
				path: "src/foo.ts",
				line: 3,
				diffSide: "RIGHT",
				comments: { ...submittedThread.comments, nodes: [root, reply] },
			},
		],
		null,
	);
}

export function makeResolvedInterruptedPromotionReview(): unknown {
	const root = {
		...pendingThread.comments.nodes[0],
		id: "COMMENT_new",
		body: "Local note",
		bodyHTML: "<p>Local note</p>",
	};
	return makeReview(
		[
			{
				...pendingThread,
				id: "THREAD_new",
				isResolved: true,
				path: "src/foo.ts",
				line: 3,
				diffSide: "RIGHT",
				comments: { ...pendingThread.comments, nodes: [root] },
			},
		],
		"REVIEW_pending",
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

export function makePaginatedThreadReview(): unknown {
	return makeReview(
		[
			{
				...submittedThread,
				comments: {
					pageInfo: { hasNextPage: true, endCursor: "COMMENTS_cursor" },
					nodes: submittedThread.comments.nodes,
				},
			},
		],
		"REVIEW_pending",
	);
}

interface GhShimOptions {
	addedThreadCanResolve?: boolean;
	addThreadDelayMs?: number;
	discoveredPullRequest?: boolean;
	failAddThread?: boolean;
	failAddReply?: boolean;
	failDeleteComment?: boolean;
	failDiscardReview?: boolean;
	failResolve?: boolean;
	failThreadComments?: boolean;
	mergeBaseOid?: string;
	noPullRequest?: boolean;
	persistCreatedReview?: boolean;
	reviewQueryDelayMs?: number;
	recoveryPullRequestNodeId?: string;
	recoveryPullRequestNumber?: number;
	recoveryRootState?: "PENDING" | "COMMENTED";
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
	repoRoot?: string;
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
		const shim = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const query = (args.find((a) => a.startsWith("query=")) || "");
const fields = args.filter((a) => !a.startsWith("query=") && a !== "-f" && a !== "-F" && a !== "api" && a !== "graphql").join(" ");
const log = ${JSON.stringify(path.join(this.tmpDir, "gh-log.txt"))};
const reviewPath = ${JSON.stringify(reviewPath)};
function emit(o) { process.stdout.write(JSON.stringify(o)); }
function sleep(ms) { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
if (args.some((arg) => arg.includes("/compare/"))) {
  emit({ merge_base_commit: { sha: ${JSON.stringify(options.mergeBaseOid ?? MERGE_BASE)} } });
} else if (args[0] === "pr" && args[1] === "view") {
  if (${options.noPullRequest ? "true" : "false"}) {
    process.stderr.write("no pull requests found for branch \\"feature\\"\\n");
    process.exit(1);
  }
  emit(${options.discoveredPullRequest ? `{ number: 5, title: "Other branch", body: "", url: "https://github.com/owner/repo/pull/5", state: "OPEN", isDraft: false, mergedAt: null, createdAt: "2026-01-01T00:00:00Z", author: { login: "octocat" }, headRefName: "other", headRefOid: ${JSON.stringify(HEAD)}, baseRefName: "main" }` : "{}"});
} else if (query.includes("query GetReviewThreadComments")) {
  fs.appendFileSync(log, "get-thread-comments\\n");
  if (${options.failThreadComments ? "true" : "false"}) { process.stderr.write("gh: follow-up page failed\\n"); process.exit(1); }
  emit({ data: { node: { comments: {
    pageInfo: { hasNextPage: false, endCursor: null },
    nodes: [{
      id: "COMMENT_late",
      url: "https://github.com/owner/repo/pull/5#discussion_r101",
      body: "Late draft reply",
      bodyHTML: "<p>Late draft reply</p>",
      createdAt: "2026-01-04T00:00:00Z",
      author: { login: "octocat", avatarUrl: "https://x/o.png" },
      pullRequestReview: { state: "PENDING" }
    }]
  } } } });
} else if (query.includes("query GetPromotionThread")) {
  fs.appendFileSync(log, "get-promotion-thread\\n");
  emit({ data: { node: {
    pullRequest: {
      id: ${JSON.stringify(options.recoveryPullRequestNodeId ?? "PR_node")},
      number: ${options.recoveryPullRequestNumber ?? this.prNumber}
    },
    comments: { nodes: [{
      id: "COMMENT_new",
      pullRequestReview: { state: ${JSON.stringify(options.recoveryRootState ?? "PENDING")} }
    }] }
  } } });
} else if (query.includes("query GetReview")) {
  sleep(${options.reviewQueryDelayMs ?? 0});
  const commentFields = query.slice(query.indexOf("comments(first: 100)"), query.indexOf("author {"));
  const illegalCommentField = ["databaseId", "diffSide", "startDiffSide"].find((field) => commentFields.includes(field));
  if (illegalCommentField) {
    process.stderr.write("gh: PullRequestReviewComment has no field " + illegalCommentField + "\\n");
    process.exit(1);
  }
  emit(JSON.parse(fs.readFileSync(reviewPath, "utf8")));
} else if (query.includes("mutation CreatePendingReview")) {
  fs.appendFileSync(log, "create-review " + fields + "\\n");
  if (${options.persistCreatedReview ? "true" : "false"}) {
    const review = JSON.parse(fs.readFileSync(reviewPath, "utf8"));
    review.data.repository.pullRequest.reviews.nodes = [{
      id: "REVIEW_new",
      body: "",
      commit: { oid: review.data.repository.pullRequest.headRefOid }
    }];
    fs.writeFileSync(reviewPath, JSON.stringify(review));
  }
  emit({ data: { addPullRequestReview: { pullRequestReview: { id: "REVIEW_new" } } } });
} else if (query.includes("mutation AddReviewThread")) {
  fs.appendFileSync(log, "add-thread " + fields + "\\n");
  sleep(${options.addThreadDelayMs ?? 0});
  if (${options.failAddThread ? "true" : "false"}) { process.stderr.write("gh: line not in diff\\n"); process.exit(1); }
  emit({ data: { addPullRequestReviewThread: { thread: { id: "THREAD_new", viewerCanResolve: ${options.addedThreadCanResolve === false ? "false" : "true"}, comments: { nodes: [{ id: "COMMENT_new" }] } } } } });
} else if (query.includes("mutation ResolveThread")) {
  fs.appendFileSync(log, "resolve-thread\\n");
  if (${options.failResolve ? "true" : "false"}) { process.stderr.write("gh: resolve failed\\n"); process.exit(1); }
  emit({ data: { resolveReviewThread: { thread: { id: "THREAD_new" } } } });
} else if (query.includes("mutation DeleteReviewComment")) {
  fs.appendFileSync(log, "delete-comment\\n");
  if (${options.failDeleteComment ? "true" : "false"}) { process.stderr.write("gh: delete failed\\n"); process.exit(1); }
  emit({ data: { deletePullRequestReviewComment: { pullRequestReviewComment: { id: "COMMENT_new" } } } });
} else if (query.includes("mutation UpdateReviewComment")) {
  fs.appendFileSync(log, "edit-comment " + fields + "\\n");
  emit({ data: { updatePullRequestReviewComment: { pullRequestReviewComment: { id: "COMMENT_new" } } } });
} else if (query.includes("mutation DiscardReview")) {
  fs.appendFileSync(log, "discard-review\\n");
  if (${options.failDiscardReview ? "true" : "false"}) { process.stderr.write("gh: discard failed\\n"); process.exit(1); }
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
				repoRoot: options.repoRoot ?? this.repoRoot,
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
			routes: [...commentRoutes(this.db, this.repoRoot), ...reviewRoutes(this.db)],
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
}
