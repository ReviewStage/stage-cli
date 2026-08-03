// @vitest-environment happy-dom

import type { CommentThread } from "@stagereview/types/comments";
import type { ReviewResponse, ReviewThread } from "@stagereview/types/review";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReview } from "../use-review";
import { makeWrapper } from "./fixtures";

const LOCAL_THREAD: CommentThread = {
	id: "THREAD_local",
	filePath: "src/foo.ts",
	side: "additions",
	startLine: 3,
	endLine: 3,
	resolvedAt: null,
	createdAt: "2026-01-01T00:00:00Z",
	updatedAt: "2026-01-01T00:00:00Z",
	comments: [
		{
			id: "COMMENT_local",
			body: "Promote me",
			authorId: "local",
			createdAt: "2026-01-01T00:00:00Z",
			updatedAt: "2026-01-01T00:00:00Z",
		},
	],
};

const REMOTE_THREAD: ReviewThread = {
	id: "THREAD_remote",
	source: "github",
	threadNodeId: "THREAD_remote",
	viewerCanResolve: true,
	viewerCanUnresolve: true,
	viewerCanReply: true,
	filePath: "src/foo.ts",
	side: "additions",
	startSide: "additions",
	startLine: 3,
	endLine: 3,
	isResolved: false,
	comments: [
		{
			id: "COMMENT_remote",
			state: "pending",
			body: "Promote me",
			bodyHtml: "<p>Promote me</p>",
			author: { login: "octocat", avatarUrl: null },
			nodeId: "COMMENT_remote",
			htmlUrl: "https://github.com/owner/repo/pull/1#discussion_r1",
			createdAt: "2026-01-01T00:00:00Z",
		},
	],
};

const review = (promoted: boolean): ReviewResponse => ({
	github: "available",
	threads: promoted ? [REMOTE_THREAD] : [],
	pendingComments: [],
	pendingCommentCount: promoted ? 1 : 0,
	hasPendingReview: promoted,
	pendingReviewBody: "",
	isOwnPullRequest: false,
	canPushToReview: true,
	canWriteToGitHub: true,
});

afterEach(() => vi.unstubAllGlobals());

describe("useReview promotion", () => {
	it("does not resolve a GitHub mutation until the review refetch completes", async () => {
		let reviewReads = 0;
		let releaseRefetch: (response: Response) => void = () => {
			throw new Error("Review refetch gate was not initialized");
		};
		const refetchGate = new Promise<Response>((resolve) => {
			releaseRefetch = resolve;
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = typeof input === "string" ? input : input.toString();
				const method = init?.method ?? "GET";
				if (url.endsWith("/review") && method === "GET") {
					reviewReads += 1;
					return reviewReads === 1 ? jsonResponse(review(false)) : refetchGate;
				}
				if (url.endsWith("/review/comment") && method === "POST") return jsonResponse({});
				return new Response("not found", { status: 404 });
			}),
		);
		const { Wrapper } = makeWrapper();
		const { result } = renderHook(() => useReview("run1"), { wrapper: Wrapper });
		await waitFor(() => expect(result.current.github).toBe("available"));

		let mutationSettled = false;
		const mutation = result.current
			.createGitHubComment({
				filePath: "src/foo.ts",
				side: "additions",
				startLine: 3,
				endLine: 3,
				body: "Pending comment",
				pending: true,
			})
			.finally(() => {
				mutationSettled = true;
			});
		await waitFor(() => expect(reviewReads).toBe(2));
		expect(mutationSettled).toBe(false);

		releaseRefetch(jsonResponse(review(true)));
		await act(async () => mutation);
		expect(mutationSettled).toBe(true);
		await waitFor(() => expect(result.current.pendingCommentCount).toBe(1));
	});

	it("removes the local overlay even when its post-promotion refresh fails", async () => {
		let promoted = false;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = typeof input === "string" ? input : input.toString();
				const method = init?.method ?? "GET";
				if (url.endsWith("/review") && method === "GET") return jsonResponse(review(promoted));
				if (url.endsWith("/comment-threads") && method === "POST") {
					return jsonResponse(LOCAL_THREAD);
				}
				if (url.endsWith("/comment-threads") && method === "GET") {
					return promoted ? new Response("offline", { status: 500 }) : jsonResponse([LOCAL_THREAD]);
				}
				if (url.endsWith("/review/add") && method === "POST") {
					promoted = true;
					return jsonResponse({});
				}
				return new Response("not found", { status: 404 });
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
				body: "Promote me",
			});
		});
		await waitFor(() =>
			expect(result.current.threads.map((thread) => thread.id)).toEqual(["THREAD_local"]),
		);

		await act(async () => {
			await result.current.addToReview("THREAD_local");
		});

		await waitFor(() =>
			expect(result.current.threads.map((thread) => thread.id)).toEqual(["THREAD_remote"]),
		);
	});
});

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}
