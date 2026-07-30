import {
	GitHubReplyBodySchema,
	GitHubResolveBodySchema,
	type GitHubThreadsResponse,
	SubmitReviewBodySchema,
} from "@stagereview/types/github-threads";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { StageDb } from "../db/client.js";
import {
	type CommentRow,
	type CommentThreadRow,
	comment,
	commentThread,
} from "../db/schema/index.js";
import { parseGitHubRepo } from "../github/index.js";
import {
	type ReviewCommentInput,
	replyToReviewComment,
	setReviewThreadResolved,
	submitReview,
} from "../github/mutations.js";
import { fetchReviewThreads } from "../github/review-comments.js";
import { DIFF_SIDE } from "../schema.js";
import type { Route } from "../server.js";
import { resolveRunCommentScope } from "./comments.js";
import { parseJsonBody, writeJson } from "./json.js";
import { enforceSameOrigin, requireRepo, resolveRun } from "./pull-request-shared.js";

const UNAVAILABLE: GitHubThreadsResponse = { available: false, threads: [] };

/**
 * Routes for GitHub review threads: a live-fetch GET (GitHub stays the source
 * of truth for its own threads — they're never mirrored into the local DB) and
 * three mutations that submit/append to a review via `gh`.
 */
export function gitHubThreadRoutes(db: StageDb): Route[] {
	return [
		{
			method: "GET",
			pattern: "/api/runs/:runId/github-threads",
			handler: async (_req, res, params) => {
				const run = resolveRun(db, params, res);
				if (!run) return;
				const repo = parseGitHubRepo(run.originUrl);
				if (!repo || run.prNumber === null) {
					writeJson(res, 200, UNAVAILABLE);
					return;
				}
				const threads = await fetchReviewThreads(run.repoRoot, repo, run.prNumber, run.headSha);
				if (threads === null) {
					writeJson(res, 200, UNAVAILABLE);
					return;
				}
				writeJson(res, 200, { available: true, threads } satisfies GitHubThreadsResponse);
			},
		},
		{
			method: "POST",
			pattern: "/api/runs/:runId/review",
			handler: async (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
				const run = resolveRun(db, params, res);
				if (!run) return;
				const repo = requireRepo(run, res);
				if (!repo) return;
				if (run.prNumber === null) {
					writeJson(res, 400, { error: "Run has no associated pull request" });
					return;
				}
				const body = await parseJsonBody(req, res, SubmitReviewBodySchema);
				if (!body) return;

				const scope = resolveRunCommentScope(db, params.runId);
				if (!scope) {
					// Unreachable: resolveRun (above) already confirmed this run exists,
					// and no route in the codebase ever deletes a chapter_run row. A miss
					// here means an invariant broke, not a client error — fail loudly
					// (500) rather than return a misleading duplicate 404.
					throw new Error(`Run ${params.runId} vanished between resolveRun calls`);
				}
				const pending = listPendingThreads(db, scope.scopeKey, run.prNumber);
				const comments = pending.map(toReviewCommentInput);
				try {
					await submitReview(run.repoRoot, repo, run.prNumber, {
						commit_id: run.headSha,
						event: body.event,
						body: body.body,
						comments,
					});
				} catch (err) {
					// Nothing was deleted — pending comments survive a failed submit.
					writeJson(res, 502, { error: err instanceof Error ? err.message : String(err) });
					return;
				}
				// GitHub accepted the review: it is now the source of truth, so drop
				// the local pending rows (the live github-threads fetch shows them).
				db.delete(commentThread)
					.where(
						inArray(
							commentThread.id,
							pending.map((t) => t.thread.id),
						),
					)
					.run();
				writeJson(res, 200, {});
			},
		},
		{
			method: "POST",
			pattern: "/api/runs/:runId/github-threads/:commentId/replies",
			handler: async (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
				const run = resolveRun(db, params, res);
				if (!run) return;
				const repo = requireRepo(run, res);
				if (!repo) return;
				const commentId = params.commentId;
				if (run.prNumber === null || !commentId) {
					writeJson(res, 400, { error: "Run has no associated pull request" });
					return;
				}
				const body = await parseJsonBody(req, res, GitHubReplyBodySchema);
				if (!body) return;
				try {
					await replyToReviewComment(run.repoRoot, repo, run.prNumber, commentId, body.body);
				} catch (err) {
					writeJson(res, 502, { error: err instanceof Error ? err.message : String(err) });
					return;
				}
				writeJson(res, 200, {});
			},
		},
		{
			method: "PATCH",
			pattern: "/api/runs/:runId/github-threads/:threadNodeId/resolve",
			handler: async (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
				const run = resolveRun(db, params, res);
				if (!run) return;
				const threadNodeId = params.threadNodeId;
				if (!threadNodeId) {
					writeJson(res, 400, { error: "Missing threadNodeId" });
					return;
				}
				const body = await parseJsonBody(req, res, GitHubResolveBodySchema);
				if (!body) return;
				try {
					await setReviewThreadResolved(run.repoRoot, threadNodeId, body.resolved);
				} catch (err) {
					writeJson(res, 502, { error: err instanceof Error ? err.message : String(err) });
					return;
				}
				writeJson(res, 200, {});
			},
		},
	];
}

interface PendingThread {
	thread: CommentThreadRow;
	comments: CommentRow[];
}

/** Pending threads for this scope + PR, each with its ordered comments. */
function listPendingThreads(db: StageDb, scopeKey: string, prNumber: number): PendingThread[] {
	const threads = db
		.select()
		.from(commentThread)
		.where(and(eq(commentThread.scopeKey, scopeKey), eq(commentThread.prNumber, prNumber)))
		.orderBy(asc(commentThread.createdAt))
		.all();
	return threads.map((thread) => ({
		thread,
		comments: db
			.select()
			.from(comment)
			.where(eq(comment.threadId, thread.id))
			.orderBy(asc(comment.createdAt))
			.all(),
	}));
}

const GH_SIDE: Record<CommentThreadRow["side"], "LEFT" | "RIGHT"> = {
	[DIFF_SIDE.ADDITIONS]: "RIGHT",
	[DIFF_SIDE.DELETIONS]: "LEFT",
};

/**
 * A local thread (root + local replies) becomes one review comment — GitHub's
 * atomic review call has no reply concept, so every local comment body in the
 * thread is concatenated into the single comment GitHub receives.
 */
function toReviewCommentInput(p: PendingThread): ReviewCommentInput {
	const side = GH_SIDE[p.thread.side];
	const input: ReviewCommentInput = {
		path: p.thread.filePath,
		body: p.comments.map((c) => c.body).join("\n\n---\n\n"),
		line: p.thread.endLine,
		side,
	};
	if (p.thread.startLine !== p.thread.endLine) {
		input.start_line = p.thread.startLine;
		input.start_side = side;
	}
	return input;
}
