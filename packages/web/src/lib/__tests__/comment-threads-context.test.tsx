// @vitest-environment happy-dom

import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "@/components/ui/sonner";
import { CommentThreadsProvider } from "../comment-threads-context";
import { makeWrapper } from "./fixtures";

vi.mock("@/components/ui/sonner", () => ({ toast: { error: vi.fn() } }));

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
				expect.anything(),
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
});
