// @vitest-environment happy-dom

import type { CommentThread } from "@stagereview/types/comments";
import type { ReviewResponse } from "@stagereview/types/review";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReview } from "../use-review";
import { makeWrapper } from "./fixtures";

const localThread = (id: string): CommentThread => ({
	id: `THREAD_${id}`,
	filePath: "src/foo.ts",
	side: "additions",
	startLine: 3,
	endLine: 3,
	resolvedAt: null,
	createdAt: "2026-01-01T00:00:00Z",
	updatedAt: "2026-01-01T00:00:00Z",
	comments: [
		{
			id: `COMMENT_${id}`,
			body: `${id} comment`,
			authorId: "local",
			createdAt: "2026-01-01T00:00:00Z",
			updatedAt: "2026-01-01T00:00:00Z",
		},
	],
});

const FIRST_THREAD = localThread("first");
const SECOND_THREAD = localThread("second");
const AVAILABLE_REVIEW: ReviewResponse = {
	github: "available",
	threads: [],
	pendingComments: [],
	pendingCommentCount: 0,
	hasPendingReview: false,
	pendingReviewBody: "",
	isOwnPullRequest: false,
	canPushToReview: true,
	canWriteToGitHub: true,
};

afterEach(() => vi.unstubAllGlobals());

describe("useReview local overlay", () => {
	it("ignores an older reconciliation that finishes after a newer local write", async () => {
		let postCount = 0;
		const reconcileResolvers: Array<(response: Response) => void> = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = typeof input === "string" ? input : input.toString();
				const method = init?.method ?? "GET";
				if (url.endsWith("/review")) return jsonResponse(AVAILABLE_REVIEW);
				if (url.endsWith("/comment-threads") && method === "POST") {
					postCount += 1;
					return jsonResponse(postCount === 1 ? FIRST_THREAD : SECOND_THREAD);
				}
				if (url.endsWith("/comment-threads")) {
					return new Promise<Response>((resolve) => reconcileResolvers.push(resolve));
				}
				return new Response("not found", { status: 404 });
			}),
		);
		const { Wrapper } = makeWrapper();
		const { result } = renderHook(() => useReview("run1"), { wrapper: Wrapper });
		await waitFor(() => expect(result.current.github).toBe("available"));

		for (const body of ["first comment", "second comment"]) {
			await act(async () => {
				await result.current.createLocalThread({
					filePath: "src/foo.ts",
					side: "additions",
					startLine: 3,
					endLine: 3,
					body,
				});
			});
		}
		await waitFor(() => expect(reconcileResolvers).toHaveLength(2));
		expect(result.current.threads.map((thread) => thread.id)).toEqual([
			"THREAD_first",
			"THREAD_second",
		]);

		const resolveFirst = reconcileResolvers.at(0);
		const resolveSecond = reconcileResolvers.at(1);
		if (!resolveFirst || !resolveSecond) throw new Error("Expected two reconciliation requests");
		await act(async () => resolveSecond(jsonResponse([FIRST_THREAD, SECOND_THREAD])));
		await act(async () => resolveFirst(jsonResponse([FIRST_THREAD])));

		expect(result.current.threads.map((thread) => thread.id)).toEqual([
			"THREAD_first",
			"THREAD_second",
		]);
	});
});

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}
