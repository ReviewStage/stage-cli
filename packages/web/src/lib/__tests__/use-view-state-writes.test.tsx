// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useViewState } from "../use-view-state";
import { gate, installFetch, makeFetchScript, makeWrapper } from "./fixtures";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("useViewState — writes", () => {
	it("markChapterViewed reflects optimistically before the request resolves", async () => {
		const script = makeFetchScript({ mutateRuns: ["run1"] });
		installFetch(script);
		const { Wrapper } = makeWrapper();

		const { result } = renderHook(() => useViewState("run1"), { wrapper: Wrapper });
		await waitFor(() => expect(result.current.isLoading).toBe(false));

		// Pause the POST so we can observe the optimistic cache before settlement.
		const release = gate(script, "POST", "/api/chapter-view/chap-1");

		act(() => {
			result.current.markChapterViewed("chap-1");
		});

		// The optimistic cache write lands on the next microtask via React Query's
		// notify manager. waitFor polls until it's visible.
		await waitFor(() => expect(result.current.isChapterViewed("chap-1")).toBe(true));

		// POST is still in flight (gated) — confirm we got an optimistic-only state.
		expect(
			script.calls.some((c) => c.method === "POST" && c.url === "/api/chapter-view/chap-1"),
		).toBe(true);

		// Release the gate; the mutation settles, the refetch sees the server side
		// committed state, and the optimistic write becomes the persisted state.
		await act(async () => {
			release();
		});

		await waitFor(() => expect(script.viewState.run1?.chapterIds).toContain("chap-1"));
		expect(result.current.isChapterViewed("chap-1")).toBe(true);
	});

	it("unmarkChapterViewed deletes and removes from cache", async () => {
		const script = makeFetchScript({
			viewState: { run1: { chapterIds: ["chap-1"], keyChangeIds: [], filePaths: [] } },
		});
		installFetch(script);
		const { Wrapper } = makeWrapper();

		const { result } = renderHook(() => useViewState("run1"), { wrapper: Wrapper });
		await waitFor(() => expect(result.current.isChapterViewed("chap-1")).toBe(true));

		act(() => {
			result.current.unmarkChapterViewed("chap-1");
		});
		await waitFor(() => expect(result.current.isChapterViewed("chap-1")).toBe(false));
		expect(
			script.calls.some((c) => c.method === "DELETE" && c.url === "/api/chapter-view/chap-1"),
		).toBe(true);
	});

	it("markKeyChangeChecked / unmarkKeyChangeChecked round-trip via the key-change endpoints", async () => {
		const script = makeFetchScript({ mutateRuns: ["run1"] });
		installFetch(script);
		const { Wrapper } = makeWrapper();

		const { result } = renderHook(() => useViewState("run1"), { wrapper: Wrapper });
		await waitFor(() => expect(result.current.isLoading).toBe(false));

		act(() => {
			result.current.markKeyChangeChecked("kc-1");
		});
		await waitFor(() => expect(result.current.isKeyChangeChecked("kc-1")).toBe(true));
		expect(
			script.calls.some((c) => c.method === "POST" && c.url === "/api/key-change-view/kc-1"),
		).toBe(true);

		act(() => {
			result.current.unmarkKeyChangeChecked("kc-1");
		});
		await waitFor(() => expect(result.current.isKeyChangeChecked("kc-1")).toBe(false));
		expect(
			script.calls.some((c) => c.method === "DELETE" && c.url === "/api/key-change-view/kc-1"),
		).toBe(true);
	});

	it("markFileViewed / unmarkFileViewed round-trip via /api/runs/:runId/file-views", async () => {
		const script = makeFetchScript({ mutateRuns: ["run1"] });
		installFetch(script);
		const { Wrapper } = makeWrapper();

		const { result } = renderHook(() => useViewState("run1"), { wrapper: Wrapper });
		await waitFor(() => expect(result.current.isLoading).toBe(false));

		act(() => {
			result.current.markFileViewed("src/foo.ts");
		});
		await waitFor(() => expect(result.current.isFileViewed("src/foo.ts")).toBe(true));
		expect(
			script.calls.some((c) => c.method === "POST" && c.url === "/api/runs/run1/file-views"),
		).toBe(true);
		expect(script.viewState.run1?.filePaths).toContain("src/foo.ts");

		act(() => {
			result.current.unmarkFileViewed("src/foo.ts");
		});
		await waitFor(() => expect(result.current.isFileViewed("src/foo.ts")).toBe(false));
		expect(
			script.calls.some((c) => c.method === "DELETE" && c.url === "/api/runs/run1/file-views"),
		).toBe(true);
	});

	it("rolls back optimistic state when the POST fails", async () => {
		const script = makeFetchScript({
			mutateRuns: ["run1"],
			failures: new Set(["POST /api/chapter-view/chap-1"]),
		});
		installFetch(script);
		const { Wrapper } = makeWrapper();

		const { result } = renderHook(() => useViewState("run1"), { wrapper: Wrapper });
		await waitFor(() => expect(result.current.isLoading).toBe(false));

		// Pause the failing POST so the optimistic write is observable before rollback.
		const release = gate(script, "POST", "/api/chapter-view/chap-1");
		act(() => {
			result.current.markChapterViewed("chap-1");
		});

		// Optimistic write visible mid-flight.
		await waitFor(() => expect(result.current.isChapterViewed("chap-1")).toBe(true));

		// Release the gate; the request returns 500, onError rolls back, and the
		// refetch confirms the server still has nothing.
		await act(async () => {
			release();
		});
		await waitFor(() => expect(result.current.isChapterViewed("chap-1")).toBe(false));
		expect(script.viewState.run1?.chapterIds ?? []).not.toContain("chap-1");
	});
});
