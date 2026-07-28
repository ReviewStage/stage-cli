import { and, asc, eq, inArray, or } from "drizzle-orm";
import type { StageDb } from "../db/client.js";
import {
	type CommentRow,
	type CommentThreadRow,
	comment,
	commentInsertionOrder,
	commentThread,
} from "../db/schema/index.js";

/**
 * Migration 0007 cannot safely assign a repository to a legacy thread when the
 * same diff scope exists in multiple checkouts. Keep those rows visible in every
 * matching scope until the first promotion claims one for a concrete repository.
 */
export const UNASSIGNED_REPO_ROOT = "";

export interface LocalThreadScope {
	repoRoot: string;
	scopeKey: string;
}

export interface LocalThreadRecord {
	thread: CommentThreadRow;
	comments: CommentRow[];
}

/** Load a scope's local threads and all of their comments in two queries. */
export function loadLocalThreadRecords(db: StageDb, scope: LocalThreadScope): LocalThreadRecord[] {
	const threads = db
		.select()
		.from(commentThread)
		.where(
			and(
				eq(commentThread.scopeKey, scope.scopeKey),
				or(
					eq(commentThread.repoRoot, scope.repoRoot),
					eq(commentThread.repoRoot, UNASSIGNED_REPO_ROOT),
				),
			),
		)
		.orderBy(asc(commentThread.createdAt))
		.all();
	if (threads.length === 0) return [];

	const comments = db
		.select()
		.from(comment)
		.where(
			inArray(
				comment.threadId,
				threads.map((thread) => thread.id),
			),
		)
		.orderBy(asc(comment.createdAt), asc(commentInsertionOrder))
		.all();
	const commentsByThread = new Map<string, CommentRow[]>();
	for (const row of comments) {
		const threadComments = commentsByThread.get(row.threadId);
		if (threadComments) threadComments.push(row);
		else commentsByThread.set(row.threadId, [row]);
	}

	return threads.map((thread) => ({
		thread,
		comments: commentsByThread.get(thread.id) ?? [],
	}));
}
