// @vitest-environment happy-dom

import type { Comment, CommentThread } from "@stagereview/types/comments";
import type { LocalReviewThread, ReviewResponse } from "@stagereview/types/review";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reviewQueryKey, useReview } from "../use-review";
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
const REPLY: Comment = {
	id: "COMMENT_reply",
	body: "Reply",
	authorId: "local",
	createdAt: "2026-01-01T00:01:00Z",
	updatedAt: "2026-01-01T00:01:00Z",
};
const THREAD_WITH_REPLY: CommentThread = {
	...FIRST_THREAD,
	comments: [...FIRST_THREAD.comments, REPLY],
};

const toReviewThread = (thread: CommentThread): LocalReviewThread => ({
	id: thread.id,
	source: "local",
	threadNodeId: null,
	filePath: thread.filePath,
	side: thread.side,
	startLine: thread.startLine,
	endLine: thread.endLine,
	isResolved: thread.resolvedAt !== null,
	comments: thread.comments.map((comment) => ({
		id: comment.id,
		state: "local",
		body: comment.body,
		bodyHtml: null,
		author: null,
		nodeId: null,
		htmlUrl: null,
		createdAt: comment.createdAt,
	})),
});

const reviewWith = (threads: CommentThread[]): ReviewResponse => ({
	github: "available",
	threads: threads.map(toReviewThread),
	pendingComments: [],
	pendingCommentCount: 0,
	hasPendingReview: false,
	pendingReviewBody: "",
	isOwnPullRequest: false,
	canPushToReview: true,
});

afterEach(() => vi.unstubAllGlobals());

describe("useReview reconciliation", () => {
	it("does not duplicate a thread or reply already present in a concurrent review result", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = typeof input === "string" ? input : input.toString();
				const method = init?.method ?? "GET";
				if (url.endsWith("/review")) return jsonResponse(reviewWith([THREAD_WITH_REPLY]));
				if (url.endsWith("/comment-threads") && method === "POST") {
					return jsonResponse(THREAD_WITH_REPLY);
				}
				if (url.endsWith("/replies") && method === "POST") return jsonResponse(REPLY);
				return new Response("offline", { status: 500 });
			}),
		);
		const { Wrapper } = makeWrapper();
		const { result } = renderHook(() => useReview("run1"), { wrapper: Wrapper });
		await waitFor(() => expect(result.current.github).toBe("available"));

		await act(async () => {
			await result.current.createLocalThread({
				filePath: "src/foo.ts",
				side: "additions",
				startLine: 3,
				endLine: 3,
				body: "first comment",
			});
			await result.current.replyLocal({ threadId: FIRST_THREAD.id, body: REPLY.body });
		});

		expect(result.current.threads).toHaveLength(1);
		expect(result.current.threads[0]?.comments).toHaveLength(2);
	});

	it("uses a successful review refetch started after the local mutation", async () => {
		let review = reviewWith([]);
		let localReadFails = false;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = typeof input === "string" ? input : input.toString();
				const method = init?.method ?? "GET";
				if (url.endsWith("/review")) return jsonResponse(review);
				if (url.endsWith("/comment-threads") && method === "POST") {
					return jsonResponse(FIRST_THREAD);
				}
				if (url.endsWith(`/comment-threads/${FIRST_THREAD.id}`) && method === "DELETE") {
					return jsonResponse({});
				}
				if (url.endsWith("/comment-threads")) {
					return localReadFails
						? new Response("offline", { status: 500 })
						: jsonResponse([FIRST_THREAD]);
				}
				return new Response("not found", { status: 404 });
			}),
		);
		const { client, Wrapper } = makeWrapper();
		const { result } = renderHook(() => useReview("run1"), { wrapper: Wrapper });
		await waitFor(() => expect(result.current.github).toBe("available"));

		await act(async () => {
			await result.current.createLocalThread({
				filePath: "src/foo.ts",
				side: "additions",
				startLine: 3,
				endLine: 3,
				body: "first comment",
			});
		});
		await waitFor(() =>
			expect(result.current.threads.map((thread) => thread.id)).toEqual(["THREAD_first"]),
		);

		review = reviewWith([FIRST_THREAD, SECOND_THREAD]);
		await act(async () => {
			await client.invalidateQueries({ queryKey: reviewQueryKey("run1") });
		});

		await waitFor(() =>
			expect(result.current.threads.map((thread) => thread.id)).toEqual([
				"THREAD_first",
				"THREAD_second",
			]),
		);

		localReadFails = true;
		await act(async () => {
			await result.current.deleteLocalThread(FIRST_THREAD.id);
		});
		expect(result.current.threads.map((thread) => thread.id)).toEqual(["THREAD_second"]);
	});
});

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}
