import {
	COMMENT_STATE,
	type GitHubReviewComment,
	type GitHubReviewThread,
	ReviewThreadSchema,
	THREAD_SOURCE,
} from "@stagereview/types/review";
import { describe, expect, it } from "vitest";
import {
	activeEditingCommentId,
	canEditReviewComment,
	canPublishReplyImmediately,
	canReplyToGitHubThread,
	deleteRemovesReplies,
	threadChevronClassName,
} from "../review-thread";

describe("thread chevron", () => {
	it("tracks the controlled collapsible state instead of a shared data-state attribute", () => {
		expect(threadChevronClassName(true)).toContain("rotate-90");
		expect(threadChevronClassName(false)).not.toContain("rotate-90");
	});
});

describe("GitHub reply destination", () => {
	it("keeps replies pending while every comment in the thread is still a draft", () => {
		expect(canPublishReplyImmediately(makeThread([COMMENT_STATE.PENDING]))).toBe(false);
	});

	it("allows an immediate reply once the thread has published content", () => {
		expect(
			canPublishReplyImmediately(makeThread([COMMENT_STATE.SUBMITTED, COMMENT_STATE.PENDING])),
		).toBe(true);
	});

	it("allows only an immediate reply when an older draft blocks pending writes", () => {
		expect(canReplyToGitHubThread(makeThread([COMMENT_STATE.SUBMITTED]), true, false)).toBe(true);
		expect(canReplyToGitHubThread(makeThread([COMMENT_STATE.PENDING]), true, false)).toBe(false);
	});

	it("disables replies when the pull request is read-only", () => {
		expect(canReplyToGitHubThread(makeThread([COMMENT_STATE.SUBMITTED]), false, false)).toBe(false);
	});
});

describe("GitHub pending comment actions", () => {
	it("hides edit and delete when the pending review cannot be written", () => {
		const [comment] = makeThread([COMMENT_STATE.PENDING]).comments;
		if (!comment) throw new Error("Expected a pending comment");

		expect(canEditReviewComment(comment, false)).toBe(false);
		expect(canEditReviewComment(comment, true)).toBe(true);
	});

	it("closes the editor after a pending comment is submitted", () => {
		const pendingThread = makeThread([COMMENT_STATE.PENDING]);
		const [pendingComment] = pendingThread.comments;
		if (!pendingComment) throw new Error("Expected a pending comment");

		expect(activeEditingCommentId(pendingThread.comments, pendingComment.id, true)).toBe(
			pendingComment.id,
		);

		const submittedThread = makeThread([COMMENT_STATE.SUBMITTED]);
		expect(activeEditingCommentId(submittedThread.comments, pendingComment.id, true)).toBeNull();
	});
});

describe("review thread source invariants", () => {
	const base = {
		id: "thread",
		filePath: "src/file.ts",
		side: "additions",
		startLine: 1,
		endLine: 1,
		isResolved: false,
		comments: [],
	};

	it("rejects a GitHub thread without a node id", () => {
		expect(
			ReviewThreadSchema.safeParse({
				...base,
				source: THREAD_SOURCE.GITHUB,
				threadNodeId: null,
			}).success,
		).toBe(false);
	});

	it("rejects a local thread with a GitHub node id", () => {
		expect(
			ReviewThreadSchema.safeParse({
				...base,
				source: THREAD_SOURCE.LOCAL,
				threadNodeId: "THREAD_github",
			}).success,
		).toBe(false);
	});
});

describe("deleteRemovesReplies", () => {
	it("warns for a pending GitHub root but not its reply", () => {
		const thread = makeThread([COMMENT_STATE.PENDING, COMMENT_STATE.PENDING]);
		const [root, reply] = thread.comments;
		if (!root || !reply) throw new Error("Expected a root and reply");

		expect(deleteRemovesReplies(thread, root)).toBe(true);
		expect(deleteRemovesReplies(thread, reply)).toBe(false);
	});
});

function makeThread(states: GitHubReviewComment["state"][]): GitHubReviewThread {
	return {
		id: "thread",
		source: THREAD_SOURCE.GITHUB,
		threadNodeId: "thread",
		filePath: "src/file.ts",
		side: "additions",
		startLine: 1,
		endLine: 1,
		isResolved: false,
		comments: states.map((state, index) => ({
			id: `comment-${index}`,
			state,
			body: "Comment",
			bodyHtml: "<p>Comment</p>",
			author: { login: "octocat", avatarUrl: null },
			nodeId: `comment-${index}`,
			htmlUrl: `https://github.com/owner/repo/pull/1#discussion_r${index}`,
			createdAt: "2026-01-01T00:00:00Z",
		})),
	};
}
