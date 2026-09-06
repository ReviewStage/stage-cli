import {
	CommentBodySchema,
	CreateCommentThreadBodySchema,
	ResolveThreadBodySchema,
} from "@stagereview/types/comments";
import { eq } from "drizzle-orm";
import type { StageDb } from "../db/client.js";
import { chapterRun, comment, commentThread } from "../db/schema/index.js";
import {
	LocalCommentThreadStore,
	toCommentDto,
	toThreadDto,
} from "../runs/local-comment-threads.js";
import { isLocalThreadPromotionInFlight } from "../runs/review.js";
import { REVIEW_ACTION_SCOPE, reviewActions } from "../runs/review-action-queue.js";
import { deriveScopeKey } from "../runs/scope-key.js";
import type { Route } from "../server.js";
import { parseJsonBody, writeJson } from "./json.js";
import { enforceSameOrigin } from "./pull-request-shared.js";

const THREAD_PROMOTION_IN_PROGRESS = "This comment thread is being added to the review.";

export function commentRoutes(db: StageDb): Route[] {
	const store = new LocalCommentThreadStore(db);
	return [
		// Threads are anchored to a diff scope rather than a single run, so
		// comments survive re-imports of the same diff.
		{
			method: "GET",
			pattern: "/api/runs/:runId/comment-threads",
			handler: (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
				const scopeKey = resolveRunScopeKey(db, params.runId);
				if (scopeKey === null) {
					writeJson(res, 404, { error: `Run ${params.runId} not found` });
					return;
				}
				writeJson(res, 200, store.listByScope(scopeKey).map(toThreadDto));
			},
		},
		{
			method: "POST",
			pattern: "/api/runs/:runId/comment-threads",
			handler: async (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
				const scopeKey = resolveRunScopeKey(db, params.runId);
				if (scopeKey === null) {
					writeJson(res, 404, { error: `Run ${params.runId} not found` });
					return;
				}
				const body = await parseJsonBody(req, res, CreateCommentThreadBodySchema);
				if (!body) return;
				writeJson(res, 201, toThreadDto(store.create(scopeKey, body)));
			},
		},
		{
			method: "POST",
			pattern: "/api/comment-threads/:threadId/replies",
			handler: async (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
				const threadId = params.threadId;
				if (!threadId) {
					writeJson(res, 400, { error: "Missing threadId" });
					return;
				}
				const body = await parseJsonBody(req, res, CommentBodySchema);
				if (!body) return;
				if (isLocalThreadPromotionInFlight(threadId)) {
					writeJson(res, 409, { error: THREAD_PROMOTION_IN_PROGRESS });
					return;
				}

				await reviewActions.run({ kind: REVIEW_ACTION_SCOPE.LOCAL_THREAD, threadId }, async () => {
					if (!store.exists(threadId)) {
						writeJson(res, 404, { error: `Thread ${threadId} not found` });
						return;
					}
					writeJson(res, 201, toCommentDto(store.reply(threadId, body.body)));
				});
			},
		},
		{
			// Resolve/reopen a local thread. GitHub threads resolve via the separate
			// review-resolve route, so this stays unscoped — it only touches local rows.
			method: "PATCH",
			pattern: "/api/comment-threads/:threadId",
			handler: async (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
				const threadId = params.threadId;
				if (!threadId) {
					writeJson(res, 400, { error: "Missing threadId" });
					return;
				}
				const body = await parseJsonBody(req, res, ResolveThreadBodySchema);
				if (!body) return;
				if (isLocalThreadPromotionInFlight(threadId)) {
					writeJson(res, 409, { error: THREAD_PROMOTION_IN_PROGRESS });
					return;
				}

				await reviewActions.run({ kind: REVIEW_ACTION_SCOPE.LOCAL_THREAD, threadId }, async () => {
					const updated = store.setResolved(threadId, body.resolved);
					if (!updated) {
						writeJson(res, 404, { error: `Thread ${threadId} not found` });
						return;
					}
					writeJson(res, 200, toThreadDto({ thread: updated, comments: store.comments(threadId) }));
				});
			},
		},
		{
			method: "DELETE",
			pattern: "/api/comment-threads/:threadId",
			handler: async (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
				const threadId = params.threadId;
				if (!threadId) {
					writeJson(res, 400, { error: "Missing threadId" });
					return;
				}
				if (isLocalThreadPromotionInFlight(threadId)) {
					writeJson(res, 409, { error: THREAD_PROMOTION_IN_PROGRESS });
					return;
				}
				await reviewActions.run({ kind: REVIEW_ACTION_SCOPE.LOCAL_THREAD, threadId }, async () => {
					// Idempotent: deleting an absent thread is a no-op. The cascade FK
					// removes the thread's comments.
					db.delete(commentThread).where(eq(commentThread.id, threadId)).run();
					writeJson(res, 200, {});
				});
			},
		},
		{
			method: "PATCH",
			pattern: "/api/comments/:commentId",
			handler: async (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
				const commentId = params.commentId;
				if (!commentId) {
					writeJson(res, 400, { error: "Missing commentId" });
					return;
				}
				const body = await parseJsonBody(req, res, CommentBodySchema);
				if (!body) return;
				const threadId = findCommentThreadId(db, commentId);
				if (threadId === null) {
					writeJson(res, 404, { error: `Comment ${commentId} not found` });
					return;
				}
				if (isLocalThreadPromotionInFlight(threadId)) {
					writeJson(res, 409, { error: THREAD_PROMOTION_IN_PROGRESS });
					return;
				}
				await reviewActions.run({ kind: REVIEW_ACTION_SCOPE.LOCAL_THREAD, threadId }, async () => {
					const [updated] = db
						.update(comment)
						.set({ body: body.body })
						.where(eq(comment.id, commentId))
						.returning()
						.all();
					if (!updated) {
						writeJson(res, 404, { error: `Comment ${commentId} not found` });
						return;
					}
					writeJson(res, 200, toCommentDto(updated));
				});
			},
		},
		{
			method: "DELETE",
			pattern: "/api/comments/:commentId",
			handler: async (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
				const commentId = params.commentId;
				if (!commentId) {
					writeJson(res, 400, { error: "Missing commentId" });
					return;
				}
				const threadId = findCommentThreadId(db, commentId);
				if (threadId === null) {
					writeJson(res, 200, {});
					return;
				}
				if (isLocalThreadPromotionInFlight(threadId)) {
					writeJson(res, 409, { error: THREAD_PROMOTION_IN_PROGRESS });
					return;
				}
				await reviewActions.run({ kind: REVIEW_ACTION_SCOPE.LOCAL_THREAD, threadId }, async () => {
					// Deleting the last comment removes its now-empty thread so no
					// dangling anchors linger. Idempotent for an absent comment.
					db.transaction((tx) => {
						const [row] = tx
							.select({ threadId: comment.threadId })
							.from(comment)
							.where(eq(comment.id, commentId))
							.limit(1)
							.all();
						if (!row) return;
						tx.delete(comment).where(eq(comment.id, commentId)).run();
						const remaining = tx
							.select({ id: comment.id })
							.from(comment)
							.where(eq(comment.threadId, row.threadId))
							.limit(1)
							.all();
						if (remaining.length === 0) {
							tx.delete(commentThread).where(eq(commentThread.id, row.threadId)).run();
						}
					});
					writeJson(res, 200, {});
				});
			},
		},
	];
}

function findCommentThreadId(db: StageDb, commentId: string): string | null {
	const [row] = db
		.select({ threadId: comment.threadId })
		.from(comment)
		.where(eq(comment.id, commentId))
		.limit(1)
		.all();
	return row?.threadId ?? null;
}

function resolveRunScopeKey(db: StageDb, runId: string | undefined): string | null {
	if (!runId) return null;
	const [run] = db
		.select({
			scopeKind: chapterRun.scopeKind,
			workingTreeRef: chapterRun.workingTreeRef,
			baseSha: chapterRun.baseSha,
			headSha: chapterRun.headSha,
			mergeBaseSha: chapterRun.mergeBaseSha,
		})
		.from(chapterRun)
		.where(eq(chapterRun.id, runId))
		.limit(1)
		.all();
	if (!run) return null;
	return deriveScopeKey(run);
}
