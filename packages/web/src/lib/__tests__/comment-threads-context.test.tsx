// @vitest-environment happy-dom

import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "@/components/ui/sonner";
import { CommentThreadsProvider } from "../comment-threads-context";
import { makeWrapper } from "./fixtures";

vi.mock("@/components/ui/sonner", () => ({ toast: { error: vi.fn(), dismiss: vi.fn() } }));

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

const JSON_HEADERS = { "Content-Type": "application/json" };
// The provider also loads GitHub threads; those are irrelevant here, so every
// stub answers that endpoint with "gh unavailable" and varies only the local one.
const GITHUB_UNAVAILABLE = JSON.stringify({ available: false, threads: [] });

function isCommentThreadsRequest(input: unknown): boolean {
	return String(input).includes("/comment-threads");
}

function stubCommentThreadsFetch(respond: () => Response): void {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: unknown) =>
			isCommentThreadsRequest(input)
				? respond()
				: new Response(GITHUB_UNAVAILABLE, { status: 200, headers: JSON_HEADERS }),
		),
	);
}

function stubFetch(status: number, body: string): void {
	stubCommentThreadsFetch(() => new Response(body, { status, headers: JSON_HEADERS }));
}

function commentThreadsCallCount(): number {
	return vi.mocked(fetch).mock.calls.filter((call) => isCommentThreadsRequest(call[0])).length;
}

describe("CommentThreadsProvider", () => {
	it("surfaces a failed threads fetch as a toast so it isn't mistaken for no comments", async () => {
		stubFetch(500, "boom");
		const { Wrapper } = makeWrapper();

		render(
			<CommentThreadsProvider runId="run1">
				<span>diff</span>
			</CommentThreadsProvider>,
			{ wrapper: Wrapper },
		);

		await waitFor(() =>
			expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
				"Couldn't load comments",
				expect.objectContaining({ id: "comment-threads-error" }),
			),
		);
	});

	it("surfaces a failed GitHub threads fetch under its own toast id", async () => {
		// Local threads load fine; only the gh-backed fetch fails.
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: unknown) =>
				isCommentThreadsRequest(input)
					? new Response("[]", { status: 200, headers: JSON_HEADERS })
					: new Response("boom", { status: 500 }),
			),
		);
		const { Wrapper } = makeWrapper();

		render(
			<CommentThreadsProvider runId="run1">
				<span>diff</span>
			</CommentThreadsProvider>,
			{ wrapper: Wrapper },
		);

		await waitFor(() =>
			expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
				"Couldn't load GitHub review comments",
				expect.objectContaining({ id: "github-threads-error" }),
			),
		);
	});

	it("does not toast when the fetch succeeds with no comments", async () => {
		stubFetch(200, "[]");
		const { Wrapper } = makeWrapper();

		render(
			<CommentThreadsProvider runId="run1">
				<span>diff</span>
			</CommentThreadsProvider>,
			{ wrapper: Wrapper },
		);

		await waitFor(() => expect(commentThreadsCallCount()).toBe(1));
		expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
	});

	it("dismisses the error toast once a later fetch recovers", async () => {
		let calls = 0;
		stubCommentThreadsFetch(() => {
			calls += 1;
			return calls === 1
				? new Response("boom", { status: 500 })
				: new Response("[]", { status: 200, headers: JSON_HEADERS });
		});
		const { client, Wrapper } = makeWrapper();

		render(
			<CommentThreadsProvider runId="run1">
				<span>diff</span>
			</CommentThreadsProvider>,
			{ wrapper: Wrapper },
		);

		await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
		// Ignore the no-op dismiss that runs before any error appears.
		vi.mocked(toast.dismiss).mockClear();

		await act(async () => {
			await client.refetchQueries();
		});

		await waitFor(() =>
			expect(vi.mocked(toast.dismiss)).toHaveBeenCalledWith("comment-threads-error"),
		);
	});
});
