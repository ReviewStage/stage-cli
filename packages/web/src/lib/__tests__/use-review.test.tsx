// @vitest-environment happy-dom

import type { CommentThread } from "@stagereview/types/comments";
import type { ReviewResponse, ReviewThread } from "@stagereview/types/review";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReview } from "../use-review";
import { jsonResponse, makeWrapper } from "./fixtures";

const GITHUB_THREAD: ReviewThread = {
	id: "THREAD_github",
	source: "github",
	subjectType: "LINE",
	threadNodeId: "THREAD_github",
	viewerCanResolve: true,
	viewerCanUnresolve: true,
	viewerCanReply: true,
	filePath: "src/github.ts",
	side: "additions",
	startSide: "additions",
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
	hasPendingReview: false,
	pendingReviewBody: "",
	isOwnPullRequest: false,
	canWriteToGitHub: true,
};

const LOCAL_REVIEW_THREAD: ReviewThread = {
	id: "LOCAL_REVIEW_THREAD",
	source: "local",
	threadNodeId: null,
	filePath: "src/local.ts",
	side: "additions",
	startLine: 3,
	endLine: 3,
	isResolved: false,
	comments: [
		{
			id: "COMMENT_local",
			state: "local",
			body: "Local comment",
			bodyHtml: null,
			author: null,
			nodeId: null,
			htmlUrl: null,
			createdAt: "2026-01-02T00:00:00Z",
		},
	],
};

const AVAILABLE_REVIEW_WITH_LOCAL: ReviewResponse = {
	...AVAILABLE_REVIEW,
	threads: [LOCAL_REVIEW_THREAD, GITHUB_THREAD],
};

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

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("useReview", () => {
	it("refetches the merged review after a local mutation", async () => {
		let created = false;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = typeof input === "string" ? input : input.toString();
				const method = init?.method ?? "GET";
				if (url.endsWith("/review") && method === "GET") {
					return jsonResponse(created ? AVAILABLE_REVIEW_WITH_LOCAL : AVAILABLE_REVIEW);
				}
				if (url.endsWith("/comment-threads") && method === "POST") {
					created = true;
					return jsonResponse(LOCAL_THREAD);
				}
				return new Response("not found", { status: 404 });
			}),
		);
		const { Wrapper } = makeWrapper();
		const { result } = renderHook(() => useReview("run1"), { wrapper: Wrapper });
		await waitFor(() => expect(result.current.github).toBe("available"));
		expect(result.current.threads.map((thread) => thread.id)).toEqual(["THREAD_github"]);

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
			expect(result.current.threads.map((thread) => thread.id)).toEqual([
				"LOCAL_REVIEW_THREAD",
				"THREAD_github",
			]),
		);
	});

	it("resolves a successful write even when unrelated requests fail", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = typeof input === "string" ? input : input.toString();
				if (url.endsWith("/review")) return jsonResponse(AVAILABLE_REVIEW);
				if ((init?.method ?? "GET") === "POST") return jsonResponse(LOCAL_THREAD);
				return new Response("offline", { status: 500 });
			}),
		);
		const { Wrapper } = makeWrapper();
		const { result } = renderHook(() => useReview("run1"), { wrapper: Wrapper });
		await waitFor(() => expect(result.current.github).toBe("available"));

		await expect(
			result.current.createLocalThread({
				filePath: "src/local.ts",
				side: "additions",
				startLine: 3,
				endLine: 3,
				body: "Local comment",
			}),
		).resolves.toBeDefined();
	});
});
