import type {
	CommentAuthorType,
	Comment as CommentDto,
	CommentThread as CommentThreadDto,
	CreateCommentThreadBody,
} from "@stagereview/types/comments";
import { asc, eq, inArray, sql } from "drizzle-orm";
import type { StageDb } from "../db/client.js";
import { LOCAL_USER_ID } from "../db/local-user.js";
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

/**
 * Persistence for CLI-local review comment threads. Shared by the HTTP routes
 * (browser UI) and the `stagereview comments` command (coding agents) so both
 * surfaces read and write threads identically. HTTP-only concerns — origin
 * checks, promotion locks, status codes — stay in the routes.
 */
export class LocalCommentThreadStore {
	constructor(private readonly db: StageDb) {}

	/** A diff scope's threads (oldest first) with all of their comments, in two queries. */
	listByScope(scopeKey: string): LocalThreadRecord[] {
		const threads = this.db
			.select()
			.from(commentThread)
			.where(eq(commentThread.scopeKey, scopeKey))
			.orderBy(asc(commentThread.createdAt))
			.all();
		if (threads.length === 0) return [];

		const comments = this.db
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

	find(threadId: string): LocalThreadRecord | null {
		const [thread] = this.db
			.select()
			.from(commentThread)
			.where(eq(commentThread.id, threadId))
			.limit(1)
			.all();
		if (!thread) return null;
		return { thread, comments: this.comments(threadId) };
	}

	/**
	 * Threads whose ID starts with `prefix`, across every scope. Thread IDs are
	 * UUIDs, so a short prefix is enough for a human or agent to name one; the
	 * caller decides how to treat zero or several matches.
	 */
	findByIdPrefix(prefix: string): CommentThreadRow[] {
		return this.db
			.select()
			.from(commentThread)
			.where(sql`substr(${commentThread.id}, 1, ${prefix.length}) = ${prefix}`)
			.orderBy(asc(commentThread.createdAt))
			.all();
	}

	exists(threadId: string): boolean {
		return (
			this.db
				.select({ id: commentThread.id })
				.from(commentThread)
				.where(eq(commentThread.id, threadId))
				.limit(1)
				.all().length > 0
		);
	}

	comments(threadId: string): CommentRow[] {
		return this.db
			.select()
			.from(comment)
			.where(eq(comment.threadId, threadId))
			.orderBy(asc(commentInsertionOrder))
			.all();
	}

	/** Create a thread and its root comment atomically. */
	create(
		scopeKey: string,
		input: CreateCommentThreadBody,
		authorType: CommentAuthorType,
	): LocalThreadRecord {
		return this.db.transaction((tx) => {
			const [threadRow] = tx
				.insert(commentThread)
				.values({
					scopeKey,
					filePath: input.filePath,
					side: input.side,
					startLine: input.startLine,
					endLine: input.endLine,
				})
				.returning()
				.all();
			if (!threadRow) throw new Error("comment_thread insert returned no row");
			const [commentRow] = tx
				.insert(comment)
				.values({ threadId: threadRow.id, authorId: LOCAL_USER_ID, authorType, body: input.body })
				.returning()
				.all();
			if (!commentRow) throw new Error("comment insert returned no row");
			return { thread: threadRow, comments: [commentRow] };
		});
	}

	/** Append a reply to an existing thread and bump the thread's activity timestamp. */
	reply(threadId: string, body: string, authorType: CommentAuthorType): CommentRow {
		return this.db.transaction((tx) => {
			const [commentRow] = tx
				.insert(comment)
				.values({ threadId, authorId: LOCAL_USER_ID, authorType, body })
				.returning()
				.all();
			if (!commentRow) throw new Error("comment insert returned no row");
			tx.update(commentThread)
				.set({ updatedAt: new Date() })
				.where(eq(commentThread.id, threadId))
				.run();
			return commentRow;
		});
	}

	/** Resolve or reopen a thread; null when no such thread exists. */
	setResolved(threadId: string, resolved: boolean): CommentThreadRow | null {
		const [updated] = this.db
			.update(commentThread)
			.set({ resolvedAt: resolved ? new Date() : null })
			.where(eq(commentThread.id, threadId))
			.returning()
			.all();
		return updated ?? null;
	}
}

export function toThreadDto({ thread, comments }: LocalThreadRecord): CommentThreadDto {
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

export function toCommentDto(row: CommentRow): CommentDto {
	return {
		id: row.id,
		body: row.body,
		authorId: row.authorId,
		authorType: row.authorType,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}
