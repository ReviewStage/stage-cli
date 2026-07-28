import {
	COMMENT_STATE,
	type GitHubReviewComment,
	type GitHubReviewThread,
	ReviewThreadSchema,
	THREAD_SOURCE,
} from "@stagereview/types/review";
import { describe, expect, it } from "vitest";
import { canPublishReplyImmediately, threadChevronClassName } from "../review-thread";

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
