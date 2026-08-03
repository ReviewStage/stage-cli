// @vitest-environment happy-dom

import type { CommentThread } from "@stagereview/types/comments";
import type { ReviewResponse } from "@stagereview/types/review";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reviewQueryKey, useReview } from "../use-review";
import { jsonResponse, makeWrapper } from "./fixtures";

const CREATED_THREAD: CommentThread = {
	id: "THREAD_first",
	hasPromotionRecovery: false,
	filePath: "src/foo.ts",
	side: "additions",
	startLine: 3,
	endLine: 3,
	resolvedAt: null,
	createdAt: "2026-01-01T00:00:00Z",
	updatedAt: "2026-01-01T00:00:00Z",
	comments: [
		{
			id: "COMMENT_first",
			body: "First comment",
			authorId: "local",
			createdAt: "2026-01-01T00:00:00Z",
			updatedAt: "2026-01-01T00:00:00Z",
		},
	],
};

const EMPTY_REVIEW: ReviewResponse = {
	github: "available",
	threads: [],
	pendingComments: [],
	hasPendingReview: false,
	pendingReviewBody: "",
	isOwnPullRequest: false,
	canWriteToGitHub: true,
};

afterEach(() => vi.unstubAllGlobals());

describe("useReview run navigation", () => {
	it("reconciles a late mutation only into the run that originated it", async () => {
		let resolveCreate: ((response: Response) => void) | undefined;
		let markCreateStarted: (() => void) | undefined;
		const createStarted = new Promise<void>((resolve) => {
			markCreateStarted = resolve;
		});
		const createResponse = new Promise<Response>((resolve) => {
			resolveCreate = resolve;
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = typeof input === "string" ? input : input.toString();
				const method = init?.method ?? "GET";
				if (url.endsWith("/review")) return jsonResponse(EMPTY_REVIEW);
				if (url === "/api/runs/run-a/comment-threads" && method === "POST") {
					markCreateStarted?.();
					return createResponse;
				}
				return new Response("not found", { status: 404 });
			}),
		);
		const { client, Wrapper } = makeWrapper();
		const { result, rerender } = renderHook(({ runId }) => useReview(runId), {
			wrapper: Wrapper,
			initialProps: { runId: "run-a" },
		});
		await waitFor(() => expect(result.current.github).toBe("available"));

		let pendingCreate: Promise<unknown> | undefined;
		await act(async () => {
			pendingCreate = result.current.createLocalThread({
				filePath: "src/foo.ts",
				side: "additions",
				startLine: 3,
				endLine: 3,
				body: "First comment",
			});
			await createStarted;
		});

		rerender({ runId: "run-b" });
		await waitFor(() => expect(result.current.github).toBe("available"));
		await act(async () => {
			resolveCreate?.(jsonResponse(CREATED_THREAD));
			await pendingCreate;
		});

		expect(result.current.threads).toHaveLength(0);
		const runACache = client.getQueryData<{ review: ReviewResponse }>(reviewQueryKey("run-a"));
		expect(runACache?.review.threads.map((thread) => thread.id)).toEqual(["THREAD_first"]);
	});
});
