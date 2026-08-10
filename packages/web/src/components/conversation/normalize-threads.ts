import type { ResolvedThreadInfo, TimelineReviewComment } from "@stagereview/types";
import { GHOST_TIMELINE_USER } from "@stagereview/types";
import type { GitHubUser } from "@/components/shared/user-utils";
import { COMMENT_SIDE, type CommentSide, SUBJECT_TYPE, type SubjectType } from "@/lib/diff-types";

// Vendored from hosted Stage's `packages/github/src/review-threads.ts` and
// `apps/web/src/lib/utils/normalize-threads.ts`, trimmed to the read-only
// fields the CLI's Activity tab renders (no pending-comment machinery).

/** A review comment with its author resolved (deleted accounts become the ghost user). */
export type ReviewCommentWithUser = TimelineReviewComment & { user: GitHubUser };

export interface CommentThread {
	root: ReviewCommentWithUser;
	replies: ReviewCommentWithUser[];
	isResolved: boolean;
	resolvedBy: ResolvedThreadInfo | null;
}

/**
 * Group a flat list of review comments into threads.
 *
 * GitHub sets `in_reply_to_id` on every reply to the thread's root comment, so a root is any
 * comment without `in_reply_to_id` and its replies are those pointing back at its id. Resolution
 * status is looked up by root comment id from `resolvedThreads`.
 */
export function groupIntoThreads(
	comments: TimelineReviewComment[],
	resolvedThreads?: ReadonlyMap<number, ResolvedThreadInfo>,
): CommentThread[] {
	// Deleted accounts arrive as user: null. Hosted filters these out
	// (review-threads.ts), but every other principal in the CLI's timeline
	// ghost-normalizes — dropping a root here would hide its whole thread, so
	// inline comments get the same ghost treatment for consistency.
	const withUser: ReviewCommentWithUser[] = comments.map((c) =>
		c.user != null ? { ...c, user: c.user } : { ...c, user: GHOST_TIMELINE_USER },
	);

	const roots: ReviewCommentWithUser[] = [];
	const repliesByParent = new Map<number, ReviewCommentWithUser[]>();

	for (const comment of withUser) {
		if (comment.in_reply_to_id != null) {
			let list = repliesByParent.get(comment.in_reply_to_id);
			if (!list) {
				list = [];
				repliesByParent.set(comment.in_reply_to_id, list);
			}
			list.push(comment);
		} else {
			roots.push(comment);
		}
	}

	for (const replies of repliesByParent.values()) {
		replies.sort((a, b) => a.created_at.localeCompare(b.created_at));
	}

	return roots.map((root) => ({
		root,
		replies: repliesByParent.get(root.id) ?? [],
		isResolved: resolvedThreads?.has(root.id) ?? false,
		resolvedBy: resolvedThreads?.get(root.id) ?? null,
	}));
}

export interface ThreadReply {
	nodeId: string;
	id: number;
	body: string;
	bodyHtml: string | null;
	htmlUrl: string;
	user: GitHubUser;
	createdAt: string;
}

/**
 * GitHub's diff_hunk snapshot for a review comment, paired with the line
 * coordinates it was created against. GitHub freezes diff_hunk at comment
 * creation time while `Thread.line`/`Thread.startLine` are remapped as the PR
 * head advances, so the hunk must always be sliced with these original
 * coordinates, never the thread's current ones.
 */
export interface ThreadDiffPreview {
	diffHunk: string;
	line: number | null;
	startLine: number | null;
}

export interface Thread {
	nodeId: string;
	id: number;
	path: string;
	line: number | null;
	startLine: number | null;
	side: CommentSide;
	startSide: CommentSide | null;
	subjectType: SubjectType;
	body: string;
	bodyHtml: string | null;
	diffPreview: ThreadDiffPreview | null;
	htmlUrl: string;
	user: GitHubUser;
	createdAt: string;
	isResolved: boolean;
	resolvedBy: ResolvedThreadInfo | null;
	replies: ThreadReply[];
}

/**
 * Uppercases a REST subject_type value ("line" | "file" | null) to match
 * the SUBJECT_TYPE constant ("LINE" | "FILE"). Defaults to "LINE" when null.
 */
function normalizeSubjectType(raw: string | null | undefined): SubjectType {
	if (raw === "file") return SUBJECT_TYPE.FILE;
	return SUBJECT_TYPE.LINE;
}

function normalizeSubmittedReply(r: ReviewCommentWithUser): ThreadReply {
	return {
		nodeId: r.node_id,
		id: r.id,
		body: r.body,
		bodyHtml: r.body_html ?? null,
		htmlUrl: r.html_url,
		user: r.user,
		createdAt: r.created_at,
	};
}

export function normalizeSubmittedThread(ct: CommentThread): Thread {
	const { root } = ct;
	return {
		nodeId: root.node_id,
		id: root.id,
		path: root.path,
		line:
			root.side === COMMENT_SIDE.LEFT
				? (root.original_line ?? root.line ?? null)
				: (root.line ?? root.original_line ?? null),
		startLine:
			root.start_side === COMMENT_SIDE.LEFT
				? (root.original_start_line ?? root.start_line ?? null)
				: (root.start_line ?? root.original_start_line ?? null),
		side: root.side === COMMENT_SIDE.LEFT ? COMMENT_SIDE.LEFT : COMMENT_SIDE.RIGHT,
		startSide:
			root.start_side === COMMENT_SIDE.LEFT
				? COMMENT_SIDE.LEFT
				: root.start_side === COMMENT_SIDE.RIGHT
					? COMMENT_SIDE.RIGHT
					: null,
		subjectType: normalizeSubjectType(root.subject_type),
		body: root.body,
		bodyHtml: root.body_html ?? null,
		diffPreview: root.diff_hunk
			? {
					diffHunk: root.diff_hunk,
					line: root.original_line ?? root.line ?? null,
					startLine: root.original_start_line ?? root.start_line ?? null,
				}
			: null,
		htmlUrl: root.html_url,
		user: root.user,
		createdAt: root.created_at,
		isResolved: ct.isResolved,
		resolvedBy: ct.resolvedBy,
		replies: ct.replies.map(normalizeSubmittedReply),
	};
}

export function normalizeReviewComments(
	comments: TimelineReviewComment[],
	resolvedThreads?: ReadonlyMap<number, ResolvedThreadInfo>,
): Thread[] {
	return groupIntoThreads(comments, resolvedThreads).map(normalizeSubmittedThread);
}
