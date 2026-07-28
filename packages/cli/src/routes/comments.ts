import {
	CommentBodySchema,
	type Comment as CommentDto,
	type CommentThread as CommentThreadDto,
	CreateCommentThreadBodySchema,
	ResolveThreadBodySchema,
} from "@stagereview/types/comments";
import { asc, eq } from "drizzle-orm";
import type { StageDb } from "../db/client.js";
import { LOCAL_USER_ID } from "../db/local-user.js";
import {
	type CommentRow,
	type CommentThreadRow,
	chapterRun,
	comment,
	commentInsertionOrder,
	commentThread,
} from "../db/schema/index.js";
import { type LocalThreadScope, loadLocalThreadRecords } from "../runs/local-comment-threads.js";
import { isLocalThreadPromoting, isLocalThreadPromotionPending } from "../runs/review.js";
import { REVIEW_ACTION_SCOPE, reviewActions } from "../runs/review-action-queue.js";
import { deriveScopeKey } from "../runs/scope-key.js";
import type { Route } from "../server.js";
import { parseJsonBody, writeJson } from "./json.js";
import { enforceSameOrigin } from "./pull-request-shared.js";

export function commentRoutes(db: StageDb, repoRoot: string): Route[] {
	return [
		// Threads are anchored to a repository + diff scope, not a run, so they
		// survive re-imports without crossing into a fork that shares the same SHAs.
		{
			method: "GET",
			pattern: "/api/runs/:runId/comment-threads",
			handler: (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
				const scope = resolveRunScope(db, params.runId);
				if (scope === null) {
					writeJson(res, 404, { error: `Run ${params.runId} not found` });
					return;
				}
				writeJson(res, 200, listThreads(db, scope));
			},
		},
		{
			method: "POST",
			pattern: "/api/runs/:runId/comment-threads",
			handler: async (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
				const scope = resolveRunScope(db, params.runId);
				if (scope === null) {
					writeJson(res, 404, { error: `Run ${params.runId} not found` });
					return;
				}
				const body = await parseJsonBody(req, res, CreateCommentThreadBodySchema);
				if (!body) return;

				const created = db.transaction((tx) => {
					const [threadRow] = tx
						.insert(commentThread)
						.values({
							repoRoot: scope.repoRoot,
							scopeKey: scope.scopeKey,
							filePath: body.filePath,
							side: body.side,
							startLine: body.startLine,
							endLine: body.endLine,
						})
						.returning()
						.all();
					if (!threadRow) throw new Error("comment_thread insert returned no row");
					const [commentRow] = tx
						.insert(comment)
						.values({ threadId: threadRow.id, authorId: LOCAL_USER_ID, body: body.body })
						.returning()
						.all();
					if (!commentRow) throw new Error("comment insert returned no row");
					return toThreadDto(threadRow, [commentRow]);
				});
				writeJson(res, 201, created);
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
				if (isLocalThreadPromotionPending(db, threadId)) {
					writeJson(res, 409, { error: "This comment thread is being added to the review." });
					return;
				}

				await reviewActions.run({ kind: REVIEW_ACTION_SCOPE.CHECKOUT, repoRoot }, async () => {
					if (isLocalThreadPromoting(db, threadId)) {
						writeJson(res, 409, { error: "This comment thread is being added to the review." });
						return;
					}
					if (!threadExists(db, threadId)) {
						writeJson(res, 404, { error: `Thread ${threadId} not found` });
						return;
					}
					const created = db.transaction((tx) => {
						const [commentRow] = tx
							.insert(comment)
							.values({ threadId, authorId: LOCAL_USER_ID, body: body.body })
							.returning()
							.all();
						if (!commentRow) throw new Error("comment insert returned no row");
						// Bump the thread so its updatedAt reflects the latest activity.
						tx.update(commentThread)
							.set({ updatedAt: new Date() })
							.where(eq(commentThread.id, threadId))
							.run();
						return toCommentDto(commentRow);
					});
					writeJson(res, 201, created);
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
				if (isLocalThreadPromotionPending(db, threadId)) {
					writeJson(res, 409, { error: "This comment thread is being added to the review." });
					return;
				}

				await reviewActions.run({ kind: REVIEW_ACTION_SCOPE.CHECKOUT, repoRoot }, async () => {
					if (isLocalThreadPromoting(db, threadId)) {
						writeJson(res, 409, { error: "This comment thread is being added to the review." });
						return;
					}
					const [updated] = db
						.update(commentThread)
						.set({ resolvedAt: body.resolved ? new Date() : null })
						.where(eq(commentThread.id, threadId))
						.returning()
						.all();
					if (!updated) {
						writeJson(res, 404, { error: `Thread ${threadId} not found` });
						return;
					}
					writeJson(res, 200, toThreadDto(updated, threadComments(db, threadId)));
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
				if (isLocalThreadPromotionPending(db, threadId)) {
					writeJson(res, 409, { error: "This comment thread is being added to the review." });
					return;
				}
				await reviewActions.run({ kind: REVIEW_ACTION_SCOPE.CHECKOUT, repoRoot }, async () => {
					if (isLocalThreadPromoting(db, threadId)) {
						writeJson(res, 409, { error: "This comment thread is being added to the review." });
						return;
					}
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

				await reviewActions.run({ kind: REVIEW_ACTION_SCOPE.CHECKOUT, repoRoot }, async () => {
					const [existing] = db
						.select({ threadId: comment.threadId })
						.from(comment)
						.where(eq(comment.id, commentId))
						.limit(1)
						.all();
					if (!existing) {
						writeJson(res, 404, { error: `Comment ${commentId} not found` });
						return;
					}
					if (isLocalThreadPromoting(db, existing.threadId)) {
						writeJson(res, 409, { error: "This comment thread is being added to the review." });
						return;
					}
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
				await reviewActions.run({ kind: REVIEW_ACTION_SCOPE.CHECKOUT, repoRoot }, async () => {
					const [existing] = db
						.select({ threadId: comment.threadId })
						.from(comment)
						.where(eq(comment.id, commentId))
						.limit(1)
						.all();
					if (existing && isLocalThreadPromoting(db, existing.threadId)) {
						writeJson(res, 409, { error: "This comment thread is being added to the review." });
						return;
					}
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

function resolveRunScope(db: StageDb, runId: string | undefined): LocalThreadScope | null {
	if (!runId) return null;
	const [run] = db
		.select({
			repoRoot: chapterRun.repoRoot,
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
	return { repoRoot: run.repoRoot, scopeKey: deriveScopeKey(run) };
}

function listThreads(db: StageDb, scope: LocalThreadScope): CommentThreadDto[] {
	return loadLocalThreadRecords(db, scope).map(({ thread, comments }) =>
		toThreadDto(thread, comments),
	);
}

function threadComments(db: StageDb, threadId: string): CommentRow[] {
	return db
		.select()
		.from(comment)
		.where(eq(comment.threadId, threadId))
		.orderBy(asc(comment.createdAt), asc(commentInsertionOrder))
		.all();
}

function threadExists(db: StageDb, threadId: string): boolean {
	return (
		db
			.select({ id: commentThread.id })
			.from(commentThread)
			.where(eq(commentThread.id, threadId))
			.limit(1)
			.all().length > 0
	);
}

function toThreadDto(thread: CommentThreadRow, comments: CommentRow[]): CommentThreadDto {
	return {
		id: thread.id,
		filePath: thread.filePath,
		side: thread.side,
		startLine: thread.startLine,
		endLine: thread.endLine,
		resolvedAt: thread.resolvedAt?.toISOString() ?? null,
		createdAt: thread.createdAt.toISOString(),
		updatedAt: thread.updatedAt.toISOString(),
		comments: comments.map(toCommentDto),
	};
}

function toCommentDto(row: CommentRow): CommentDto {
	return {
		id: row.id,
		body: row.body,
		authorId: row.authorId,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}
