import {
	COMMENT_AUTHOR_TYPE,
	type Comment,
	type CommentThread,
	type CreateCommentThreadBody,
} from "@stagereview/types/comments";
import type { StageDb } from "../db/client.js";
import {
	LocalCommentThreadStore,
	type LocalThreadRecord,
	toThreadDto,
} from "../runs/local-comment-threads.js";
import { deriveScopeKey, scopeKeyParts } from "../runs/scope-key.js";
import { type DiffScopeOptions, resolveDiffScope } from "../scope.js";

export const THREAD_STATUS = {
	OPEN: "open",
	RESOLVED: "resolved",
} as const;
export type ThreadStatus = (typeof THREAD_STATUS)[keyof typeof THREAD_STATUS];

export const THREAD_STATUS_FILTER = {
	...THREAD_STATUS,
	ALL: "all",
} as const;
export type ThreadStatusFilter = (typeof THREAD_STATUS_FILTER)[keyof typeof THREAD_STATUS_FILTER];

/** The HTTP wire shape plus an explicit status, so agents don't have to infer it from `resolvedAt`. */
export interface CommentThreadWithStatus extends CommentThread {
	status: ThreadStatus;
}

export interface ReplyResult {
	thread: CommentThreadWithStatus;
	comment: Comment;
}

/** Shortest thread-ID prefix the CLI accepts in place of a full UUID. */
export const MIN_THREAD_REF_LENGTH = 6;

/**
 * The scope key `stagereview comments` operates on, resolved with the exact
 * code path `show` uses so the CLI addresses the same threads the browser shows.
 */
export async function resolveCommentScopeKey(options: DiffScopeOptions): Promise<string> {
	const { scope } = await resolveDiffScope(options);
	return deriveScopeKey(scopeKeyParts(scope));
}

/**
 * Agent-facing operations on local comment threads, backed directly by the
 * SQLite database — no HTTP server involved. Every comment written here is
 * attributed to the agent so the UI can tell it apart from the human's notes.
 */
export class CommentsCli {
	private readonly store: LocalCommentThreadStore;

	constructor(db: StageDb) {
		this.store = new LocalCommentThreadStore(db);
	}

	list(scopeKey: string, status: ThreadStatusFilter): CommentThreadWithStatus[] {
		return this.store
			.listByScope(scopeKey)
			.map(withStatus)
			.filter((thread) => status === THREAD_STATUS_FILTER.ALL || thread.status === status);
	}

	show(threadRef: string): CommentThreadWithStatus {
		return this.load(this.resolveThreadId(threadRef));
	}

	reply(threadRef: string, body: string): ReplyResult {
		const threadId = this.resolveThreadId(threadRef);
		const reply = this.store.reply(threadId, body, COMMENT_AUTHOR_TYPE.AGENT);
		const thread = this.load(threadId);
		const comment = thread.comments.find((candidate) => candidate.id === reply.id);
		if (!comment) throw new Error(`Reply ${reply.id} missing from thread ${threadId}`);
		return { thread, comment };
	}

	/** Resolve a thread, optionally posting a closing reply first. */
	resolve(threadRef: string, body?: string): CommentThreadWithStatus {
		const threadId = this.resolveThreadId(threadRef);
		if (body !== undefined) this.store.reply(threadId, body, COMMENT_AUTHOR_TYPE.AGENT);
		this.store.setResolved(threadId, true);
		return this.load(threadId);
	}

	reopen(threadRef: string): CommentThreadWithStatus {
		const threadId = this.resolveThreadId(threadRef);
		this.store.setResolved(threadId, false);
		return this.load(threadId);
	}

	create(scopeKey: string, input: CreateCommentThreadBody): CommentThreadWithStatus {
		return withStatus(this.store.create(scopeKey, input, COMMENT_AUTHOR_TYPE.AGENT));
	}

	private load(threadId: string): CommentThreadWithStatus {
		const record = this.store.find(threadId);
		if (!record) throw new Error(`Thread ${threadId} not found`);
		return withStatus(record);
	}

	/** Accept a full thread ID or an unambiguous prefix of at least {@link MIN_THREAD_REF_LENGTH} characters. */
	private resolveThreadId(threadRef: string): string {
		const prefix = threadRef.trim();
		if (prefix.length < MIN_THREAD_REF_LENGTH) {
			throw new Error(
				`Thread ID "${prefix}" is too short. Use at least ${MIN_THREAD_REF_LENGTH} characters of the ID.`,
			);
		}
		const matches = this.store.findByIdPrefix(prefix);
		const [first] = matches;
		if (!first) throw new Error(`No comment thread matches "${prefix}".`);
		if (matches.length > 1) {
			const ids = matches.map((thread) => thread.id).join(", ");
			throw new Error(
				`Thread ID "${prefix}" is ambiguous — it matches ${matches.length} threads: ${ids}. Use a longer prefix.`,
			);
		}
		return first.id;
	}
}

function withStatus(record: LocalThreadRecord): CommentThreadWithStatus {
	const dto = toThreadDto(record);
	return {
		...dto,
		status: dto.resolvedAt === null ? THREAD_STATUS.OPEN : THREAD_STATUS.RESOLVED,
	};
}
