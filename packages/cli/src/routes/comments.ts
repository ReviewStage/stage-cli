import {
	CommentBodySchema,
	type Comment as CommentDto,
	type CommentThread as CommentThreadDto,
	CreateCommentThreadBodySchema,
	ResolveThreadBodySchema,
} from "@stagereview/types/comments";
import { asc, eq, inArray } from "drizzle-orm";
import type { StageDb } from "../db/client.js";
import { LOCAL_USER_ID } from "../db/local-user.js";
import {
	type ChapterRunRow,
	type CommentRow,
	type CommentThreadRow,
	chapterRun,
	comment,
	commentThread,
} from "../db/schema/index.js";
import {
	CommentSyncError,
	pullComments,
	pushComments,
	syncThreadResolution,
} from "../runs/comment-sync.js";
import { deriveScopeKey } from "../runs/scope-key.js";
import type { Route } from "../server.js";
import { parseJsonBody, writeJson } from "./json.js";
import { enforceSameOrigin } from "./pull-request-shared.js";

export function commentRoutes(db: StageDb): Route[] {
	return [
		// Threads are anchored to a diff scope, not a run, so they survive re-imports
		// of the same diff. We resolve the run's scope key and key every query off it.
		{
			method: "GET",
			pattern: "/api/runs/:runId/comment-threads",
			handler: (_req, res, params) => {
				const scopeKey = resolveRunScopeKey(db, params.runId);
				if (scopeKey === null) {
					writeJson(res, 404, { error: `Run ${params.runId} not found` });
					return;
				}
				writeJson(res, 200, listThreads(db, scopeKey));
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

				const created = db.transaction((tx) => {
					const [threadRow] = tx
						.insert(commentThread)
						.values({
							scopeKey,
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
				if (!threadId || !threadExists(db, threadId)) {
					writeJson(res, 404, { error: `Thread ${params.threadId} not found` });
					return;
				}
				const body = await parseJsonBody(req, res, CommentBodySchema);
				if (!body) return;

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
			},
		},
		{
			// Run-scoped so resolving a PR-originated thread can mirror the toggle to
			// GitHub (it needs the run's repo/PR context). Local-only threads stay local.
			method: "PATCH",
			pattern: "/api/runs/:runId/comment-threads/:threadId",
			handler: async (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
				const threadId = params.threadId;
				if (!threadId) {
					writeJson(res, 400, { error: "Missing threadId" });
					return;
				}
				const body = await parseJsonBody(req, res, ResolveThreadBodySchema);
				if (!body) return;
				const runId = params.runId;
				if (!runId) {
					writeJson(res, 400, { error: "Missing runId" });
					return;
				}
				const [run] = db.select().from(chapterRun).where(eq(chapterRun.id, runId)).limit(1).all();
				if (!run) {
					writeJson(res, 404, { error: `Run ${runId} not found` });
					return;
				}
				try {
					const updated = await syncThreadResolution(db, run, threadId, body.resolved);
					writeJson(res, 200, toThreadDto(updated, threadComments(db, threadId)));
				} catch (err) {
					if (err instanceof CommentSyncError) {
						writeJson(res, err.status, { error: err.message });
						return;
					}
					writeJson(res, 500, {
						error: err instanceof Error ? err.message : "Failed to update thread",
					});
				}
			},
		},
		{
			method: "DELETE",
			pattern: "/api/comment-threads/:threadId",
			handler: (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
				const threadId = params.threadId;
				if (!threadId) {
					writeJson(res, 400, { error: "Missing threadId" });
					return;
				}
				// Idempotent: deleting an absent thread is a no-op. The cascade FK
				// removes the thread's comments.
				db.delete(commentThread).where(eq(commentThread.id, threadId)).run();
				writeJson(res, 200, {});
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
			},
		},
		{
			method: "DELETE",
			pattern: "/api/comments/:commentId",
			handler: (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
				const commentId = params.commentId;
				if (!commentId) {
					writeJson(res, 400, { error: "Missing commentId" });
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
			},
		},
		{
			method: "POST",
			pattern: "/api/runs/:runId/comment-sync/pull",
			handler: (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
				return runSync(db, params.runId, res, pullComments);
			},
		},
		{
			method: "POST",
			pattern: "/api/runs/:runId/comment-sync/push",
			handler: (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
				return runSync(db, params.runId, res, pushComments);
			},
		},
	];
}

type Res = Parameters<Route["handler"]>[1];

/** Run a pull/push sync for a run, mapping CommentSyncError to its status and unexpected errors to 500. */
async function runSync(
	db: StageDb,
	runId: string | undefined,
	res: Res,
	sync: (db: StageDb, run: ChapterRunRow) => Promise<unknown>,
): Promise<void> {
	if (!runId) {
		writeJson(res, 400, { error: "Missing runId" });
		return;
	}
	const [run] = db.select().from(chapterRun).where(eq(chapterRun.id, runId)).limit(1).all();
	if (!run) {
		writeJson(res, 404, { error: `Run ${runId} not found` });
		return;
	}
	try {
		writeJson(res, 200, await sync(db, run));
	} catch (err) {
		if (err instanceof CommentSyncError) {
			writeJson(res, err.status, { error: err.message });
			return;
		}
		writeJson(res, 500, {
			error: err instanceof Error ? err.message : "Failed to sync comments with GitHub",
		});
	}
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

function listThreads(db: StageDb, scopeKey: string): CommentThreadDto[] {
	const threads = db
		.select()
		.from(commentThread)
		.where(eq(commentThread.scopeKey, scopeKey))
		.orderBy(asc(commentThread.createdAt))
		.all();
	if (threads.length === 0) return [];

	const comments = db
		.select()
		.from(comment)
		.where(
			inArray(
				comment.threadId,
				threads.map((t) => t.id),
			),
		)
		.orderBy(asc(comment.createdAt))
		.all();

	const byThread = new Map<string, CommentRow[]>();
	for (const c of comments) {
		const list = byThread.get(c.threadId);
		if (list) list.push(c);
		else byThread.set(c.threadId, [c]);
	}
	return threads.map((t) => toThreadDto(t, byThread.get(t.id) ?? []));
}

function threadComments(db: StageDb, threadId: string): CommentRow[] {
	return db
		.select()
		.from(comment)
		.where(eq(comment.threadId, threadId))
		.orderBy(asc(comment.createdAt))
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
	// `local` comments render as the local reviewer ("You"); others carry the
	// GitHub author pulled from the PR.
	const author =
		row.authorId === LOCAL_USER_ID ? null : { login: row.authorId, avatarUrl: row.authorAvatarUrl };
	return {
		id: row.id,
		body: row.body,
		author,
		githubCommentId: row.githubCommentId,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}
