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

function stubFetch(status: number, body: string): void {
	vi.stubGlobal(
		"fetch",
		vi.fn(
			async () => new Response(body, { status, headers: { "Content-Type": "application/json" } }),
		),
	);
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

	it("does not toast when the fetch succeeds with no comments", async () => {
		stubFetch(200, "[]");
		const { Wrapper } = makeWrapper();

		render(
			<CommentThreadsProvider runId="run1">
				<span>diff</span>
			</CommentThreadsProvider>,
			{ wrapper: Wrapper },
		);

		await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1));
		expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
	});

	it("dismisses the error toast once a later fetch recovers", async () => {
		let calls = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				calls += 1;
				return calls === 1
					? new Response("boom", { status: 500 })
					: new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
			}),
		);
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
