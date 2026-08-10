import { asc, eq, inArray } from "drizzle-orm";
import type { StageDb } from "../db/client.js";
import {
	type CommentRow,
	type CommentThreadRow,
	comment,
	commentInsertionOrder,
	commentThread,
} from "../db/schema/index.js";

export interface LocalThreadRecord {
	thread: CommentThreadRow;
	comments: CommentRow[];
}

/** Load a diff scope's local threads and all of their comments in two queries. */
export function loadLocalThreadRecords(db: StageDb, scopeKey: string): LocalThreadRecord[] {
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
				threads.map((thread) => thread.id),
			),
		)
		.orderBy(asc(commentInsertionOrder))
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
