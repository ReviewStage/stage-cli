// @vitest-environment happy-dom

import type { ReviewResponse, ReviewThread } from "@stagereview/types/review";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reviewQueryKey, useReview } from "../use-review";
import { makeWrapper } from "./fixtures";

const GITHUB_THREAD: ReviewThread = {
	id: "THREAD_github",
	source: "github",
	threadNodeId: "THREAD_github",
	viewerCanResolve: true,
	viewerCanUnresolve: true,
	filePath: "src/github.ts",
	side: "additions",
	startSide: "additions",
	startLine: 2,
	endLine: 2,
	isResolved: false,
	comments: [
		{
			id: "COMMENT_github",
			state: "pending",
			body: "GitHub comment",
			bodyHtml: "<p>GitHub comment</p>",
			author: { login: "octocat", avatarUrl: null },
			nodeId: "COMMENT_github",
			htmlUrl: "https://github.com/owner/repo/pull/1#discussion_r1",
			createdAt: "2026-01-01T00:00:00Z",
		},
	],
};

const AVAILABLE: ReviewResponse = {
	github: "available",
	threads: [GITHUB_THREAD],
	pendingComments: [
		{ id: "COMMENT_github", filePath: "src/github.ts", line: 2, body: "GitHub comment" },
	],
	pendingCommentCount: 1,
	hasPendingReview: true,
	pendingReviewBody: "Draft summary",
	isOwnPullRequest: true,
	canPushToReview: true,
	canWriteToGitHub: true,
};

const OFFLINE: ReviewResponse = {
	github: "offline",
	threads: [
		{
			id: "THREAD_local",
			source: "local",
			threadNodeId: null,
			filePath: "src/local.ts",
			side: "additions",
			startLine: 3,
			endLine: 3,
			isResolved: false,
			comments: [],
		},
	],
	pendingComments: [],
	pendingCommentCount: 0,
	hasPendingReview: false,
	pendingReviewBody: "",
	isOwnPullRequest: false,
	canPushToReview: false,
	canWriteToGitHub: false,
};

const NONE: ReviewResponse = {
	...OFFLINE,
	github: "none",
	threads: [],
};

afterEach(() => vi.unstubAllGlobals());

describe("useReview offline cache", () => {
	it("keeps cached GitHub threads read-only while refreshing local threads", async () => {
		let review = AVAILABLE;
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => jsonResponse(review)),
		);
		const { client, Wrapper } = makeWrapper();
		const { result } = renderHook(() => useReview("run1"), { wrapper: Wrapper });
		await waitFor(() => expect(result.current.github).toBe("available"));

		review = OFFLINE;
		await act(async () => {
			await client.invalidateQueries({ queryKey: reviewQueryKey("run1") });
		});

		await waitFor(() => expect(result.current.github).toBe("offline"));
		expect(result.current.threads.map((thread) => thread.id)).toEqual([
			"THREAD_local",
			"THREAD_github",
		]);
		expect(result.current.pendingCommentCount).toBe(1);
		expect(result.current.hasPendingReview).toBe(true);
		expect(result.current.pendingReviewBody).toBe("Draft summary");
		expect(result.current.canPushToReview).toBe(false);
		expect(result.current.canWriteToGitHub).toBe(false);
	});

	it("does not restore a cached PR after discovery authoritatively returns none", async () => {
		const reviews = [AVAILABLE, NONE, OFFLINE];
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => jsonResponse(reviews.shift())),
		);
		const { client, Wrapper } = makeWrapper();
		const { result } = renderHook(() => useReview("run1"), { wrapper: Wrapper });
		await waitFor(() => expect(result.current.github).toBe("available"));

		await act(async () => {
			await client.invalidateQueries({ queryKey: reviewQueryKey("run1") });
		});
		await waitFor(() => expect(result.current.github).toBe("none"));

		await act(async () => {
			await client.invalidateQueries({ queryKey: reviewQueryKey("run1") });
		});
		await waitFor(() => expect(result.current.github).toBe("offline"));
		expect(result.current.threads.map((thread) => thread.id)).toEqual(["THREAD_local"]);
		expect(result.current.pendingCommentCount).toBe(0);
	});
});

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}
