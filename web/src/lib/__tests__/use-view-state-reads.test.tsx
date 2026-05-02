// @vitest-environment happy-dom

import type { ViewState } from "@cli/types/view-state";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useViewState, viewStateQueryKey } from "../use-view-state";
import { installFetch, makeFetchScript, makeWrapper } from "./fixtures";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("useViewState — reads", () => {
	it("hydrates the initial viewed sets from GET /api/runs/:runId/view-state", async () => {
		const script = makeFetchScript({
			viewState: { run1: { chapterIds: ["chap-a"], keyChangeIds: ["kc-a"] } },
		});
		installFetch(script);
		const { Wrapper } = makeWrapper();

		const { result } = renderHook(() => useViewState("run1"), { wrapper: Wrapper });

		await waitFor(() => expect(result.current.isLoading).toBe(false));
		expect(result.current.isChapterViewed("chap-a")).toBe(true);
		expect(result.current.isKeyChangeChecked("kc-a")).toBe(true);
		expect(result.current.isChapterViewed("chap-b")).toBe(false);
		expect(result.current.isKeyChangeChecked("kc-b")).toBe(false);
	});

	it("idempotent mark of an already-viewed chapter does not duplicate cache entries", async () => {
		const script = makeFetchScript({
			viewState: { run1: { chapterIds: ["chap-1"], keyChangeIds: [] } },
		});
		installFetch(script);
		const { client, Wrapper } = makeWrapper();

		const { result } = renderHook(() => useViewState("run1"), { wrapper: Wrapper });
		await waitFor(() => expect(result.current.isChapterViewed("chap-1")).toBe(true));

		act(() => {
			result.current.markChapterViewed("chap-1");
		});

		await waitFor(() => {
			const cached = client.getQueryData<ViewState>(viewStateQueryKey("run1"));
			expect(cached?.chapterIds).toEqual(["chap-1"]);
		});
		expect(result.current.isChapterViewed("chap-1")).toBe(true);
	});

	it("changing runId triggers a refetch and isolates state per run", async () => {
		const script = makeFetchScript({
			viewState: {
				run1: { chapterIds: ["chap-a"], keyChangeIds: [] },
				run2: { chapterIds: ["chap-b"], keyChangeIds: ["kc-b"] },
			},
		});
		installFetch(script);
		const { Wrapper } = makeWrapper();

		const { result, rerender } = renderHook(({ runId }) => useViewState(runId), {
			wrapper: Wrapper,
			initialProps: { runId: "run1" },
		});

		await waitFor(() => expect(result.current.isChapterViewed("chap-a")).toBe(true));
		expect(result.current.isChapterViewed("chap-b")).toBe(false);

		rerender({ runId: "run2" });

		await waitFor(() => expect(result.current.isChapterViewed("chap-b")).toBe(true));
		expect(result.current.isKeyChangeChecked("kc-b")).toBe(true);
		expect(result.current.isChapterViewed("chap-a")).toBe(false);

		const run1Calls = script.calls.filter((c) => c.url.includes("/runs/run1/view-state"));
		const run2Calls = script.calls.filter((c) => c.url.includes("/runs/run2/view-state"));
		expect(run1Calls.length).toBeGreaterThanOrEqual(1);
		expect(run2Calls.length).toBeGreaterThanOrEqual(1);
	});
});
