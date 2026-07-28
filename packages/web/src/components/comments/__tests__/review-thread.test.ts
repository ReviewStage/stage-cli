import { COMMENT_STATE, type ReviewThread, THREAD_SOURCE } from "@stagereview/types/review";
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

function makeThread(states: ReviewThread["comments"][number]["state"][]): ReviewThread {
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
			bodyHtml: null,
			author: null,
			nodeId: `comment-${index}`,
			htmlUrl: null,
			createdAt: "2026-01-01T00:00:00Z",
		})),
	};
}
