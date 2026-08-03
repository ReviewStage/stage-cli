// @vitest-environment happy-dom

import type { CommentThread } from "@stagereview/types/comments";
import type { LocalReviewThread, ReviewResponse } from "@stagereview/types/review";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReview } from "../use-review";
import { jsonResponse, makeWrapper } from "./fixtures";

const LOCAL_THREAD: CommentThread = {
	id: "THREAD_local",
	hasPromotionRecovery: true,
	filePath: "src/foo.ts",
	side: "additions",
	startLine: 3,
	endLine: 3,
	resolvedAt: null,
	createdAt: "2026-01-01T00:00:00Z",
	updatedAt: "2026-01-01T00:00:00Z",
	comments: [],
};

const REVIEW_THREAD: LocalReviewThread = {
	id: LOCAL_THREAD.id,
	source: "local",
	threadNodeId: null,
	hasPromotionRecovery: true,
	filePath: LOCAL_THREAD.filePath,
	side: LOCAL_THREAD.side,
	startLine: LOCAL_THREAD.startLine,
	endLine: LOCAL_THREAD.endLine,
	isResolved: false,
	comments: [],
};

const REVIEW: ReviewResponse = {
	github: "available",
	threads: [REVIEW_THREAD],
	pendingComments: [],
	pendingCommentCount: 0,
	hasPendingReview: false,
	pendingReviewBody: "",
	isOwnPullRequest: false,
	canPushToReview: false,
	canWriteToGitHub: false,
};

afterEach(() => vi.unstubAllGlobals());

describe("useReview promotion recovery", () => {
	it("preserves recovery through a local resolution update and refresh", async () => {
		const resolvedThread = { ...LOCAL_THREAD, resolvedAt: "2026-01-02T00:00:00Z" };
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = typeof input === "string" ? input : input.toString();
				const method = init?.method ?? "GET";
				if (url.endsWith("/review")) return jsonResponse(REVIEW);
				if (url.endsWith(`/comment-threads/${LOCAL_THREAD.id}`) && method === "PATCH") {
					return jsonResponse(resolvedThread);
				}
				if (url.endsWith("/comment-threads")) return jsonResponse([resolvedThread]);
				return new Response("not found", { status: 404 });
			}),
		);
		const { Wrapper } = makeWrapper();
		const { result } = renderHook(() => useReview("run1"), { wrapper: Wrapper });
		await waitFor(() => expect(result.current.threads).toHaveLength(1));

		await act(async () => {
			await result.current.resolveLocalThread({ threadId: LOCAL_THREAD.id, resolved: true });
		});
		await waitFor(() => expect(result.current.threads[0]?.isResolved).toBe(true));
		expect(result.current.threads[0]).toMatchObject({ hasPromotionRecovery: true });
	});
});
