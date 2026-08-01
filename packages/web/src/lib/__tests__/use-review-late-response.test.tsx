// @vitest-environment happy-dom

import type { CommentThread } from "@stagereview/types/comments";
import type { ReviewResponse, ReviewThread } from "@stagereview/types/review";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReview } from "../use-review";
import { makeWrapper } from "./fixtures";

const LOCAL_THREAD: CommentThread = {
	id: "THREAD_local",
	filePath: "src/local.ts",
	side: "additions",
	startLine: 3,
	endLine: 3,
	resolvedAt: null,
	createdAt: "2026-01-02T00:00:00Z",
	updatedAt: "2026-01-02T00:00:00Z",
	comments: [
		{
			id: "COMMENT_local",
			body: "Local comment",
			authorId: "local",
			createdAt: "2026-01-02T00:00:00Z",
			updatedAt: "2026-01-02T00:00:00Z",
		},
	],
};

const GITHUB_THREAD: ReviewThread = {
	id: "THREAD_github",
	source: "github",
	threadNodeId: "THREAD_github",
	viewerCanResolve: true,
	viewerCanUnresolve: true,
	filePath: "src/github.ts",
	side: "additions",
	startLine: 2,
	endLine: 2,
	isResolved: false,
	comments: [
		{
			id: "COMMENT_github",
			state: "submitted",
			body: "GitHub comment",
			bodyHtml: "<p>GitHub comment</p>",
			author: { login: "octocat", avatarUrl: null },
			nodeId: "COMMENT_github",
			htmlUrl: "https://github.com/owner/repo/pull/1#discussion_r1",
			createdAt: "2026-01-01T00:00:00Z",
		},
	],
};

const AVAILABLE_REVIEW: ReviewResponse = {
	github: "available",
	threads: [GITHUB_THREAD],
	pendingComments: [],
	pendingCommentCount: 0,
	hasPendingReview: false,
	pendingReviewBody: "",
	isOwnPullRequest: false,
	canPushToReview: true,
	canWriteToGitHub: true,
};

afterEach(() => vi.unstubAllGlobals());

describe("useReview late responses", () => {
	it("keeps a local write visible when the initial review fetch finishes later", async () => {
		let resolveReview: ((response: Response) => void) | undefined;
		const pendingReview = new Promise<Response>((resolve) => {
			resolveReview = resolve;
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = typeof input === "string" ? input : input.toString();
				const method = init?.method ?? "GET";
				if (url.endsWith("/review")) return pendingReview;
				if (url.endsWith("/comment-threads") && method === "POST") {
					return jsonResponse(LOCAL_THREAD);
				}
				if (url.endsWith("/comment-threads")) return jsonResponse([LOCAL_THREAD]);
				return new Response("not found", { status: 404 });
			}),
		);
		const { Wrapper } = makeWrapper();
		const { result } = renderHook(() => useReview("run1"), { wrapper: Wrapper });

		await act(async () => {
			await result.current.createLocalThread({
				filePath: "src/local.ts",
				side: "additions",
				startLine: 3,
				endLine: 3,
				body: "Local comment",
			});
		});
		await waitFor(() =>
			expect(result.current.threads.map((thread) => thread.id)).toEqual(["THREAD_local"]),
		);

		if (!resolveReview) throw new Error("Review response gate was not initialized");
		resolveReview(jsonResponse(AVAILABLE_REVIEW));
		await waitFor(() => expect(result.current.github).toBe("available"));
		expect(result.current.threads.map((thread) => thread.id)).toEqual([
			"THREAD_local",
			"THREAD_github",
		]);
	});
});

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}
