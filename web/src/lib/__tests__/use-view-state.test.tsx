// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useViewState, type ViewState, viewStateQueryKey } from "../use-view-state";

interface FetchCall {
	url: string;
	method: string;
}

interface FetchScript {
	/**
	 * Per-runId view-state. POST/DELETE mutations update this in place so a
	 * post-mutation refetch sees the same state the SPA wrote optimistically
	 * (mirrors the real server's behavior — without this, the refetch from
	 * onSettled would overwrite the optimistic cache and tests couldn't see
	 * the final state).
	 */
	viewState: Record<string, ViewState>;
	/** runIds whose viewState gets touched by chapter-view / key-change-view mutations. */
	mutateRuns: string[];
	/** When set, the matching method+url combination returns 500. */
	failures: Set<string>;
	/** Records every fetch call in the order they happen. */
	calls: FetchCall[];
	/**
	 * Optional gate keyed by `${method} ${url}`. While the value is `null`, the
	 * fetch hangs. Calling `releaseGate(key)` resolves it; the response is then
	 * returned as if the gate had never existed. Used to observe optimistic state
	 * mid-mutation before letting the request settle.
	 */
	gates: Map<string, { promise: Promise<void>; release: () => void } | null>;
}

function makeFetchScript(over: Partial<FetchScript> = {}): FetchScript {
	const merged: FetchScript = {
		viewState: {},
		mutateRuns: [],
		failures: new Set(),
		calls: [],
		gates: new Map(),
		...over,
	};
	if (merged.mutateRuns.length === 0) {
		merged.mutateRuns = Object.keys(merged.viewState);
	}
	return merged;
}

function ensureRun(script: FetchScript, runId: string): ViewState {
	let state = script.viewState[runId];
	if (!state) {
		state = { chapterIds: [], keyChangeIds: [] };
		script.viewState[runId] = state;
	}
	return state;
}

/** Mark the next call to (method, url) as gated; returns the release function. */
function gate(script: FetchScript, method: string, url: string): () => void {
	const key = `${method} ${url}`;
	let release!: () => void;
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	script.gates.set(key, { promise, release });
	return () => {
		release();
		script.gates.delete(key);
	};
}

async function maybeWaitGate(script: FetchScript, method: string, url: string): Promise<void> {
	const key = `${method} ${url}`;
	const entry = script.gates.get(key);
	if (entry) await entry.promise;
}

function installFetch(script: FetchScript): void {
	const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = typeof input === "string" ? input : input.toString();
		const method = (init?.method ?? "GET").toUpperCase();
		script.calls.push({ url, method });

		const failureKey = `${method} ${url}`;
		if (script.failures.has(failureKey)) {
			await maybeWaitGate(script, method, url);
			return new Response("boom", { status: 500 });
		}

		const viewMatch = url.match(/\/api\/runs\/([^/]+)\/view-state$/);
		if (method === "GET" && viewMatch) {
			const runId = decodeURIComponent(viewMatch[1] ?? "");
			await maybeWaitGate(script, method, url);
			const body = script.viewState[runId] ?? { chapterIds: [], keyChangeIds: [] };
			return new Response(JSON.stringify(body), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}

		const chapterMatch = url.match(/\/api\/chapter-view\/(.+)$/);
		if (chapterMatch) {
			const id = decodeURIComponent(chapterMatch[1] ?? "");
			await maybeWaitGate(script, method, url);
			const runs = script.mutateRuns.length > 0 ? script.mutateRuns : Object.keys(script.viewState);
			for (const runId of runs) {
				const state = ensureRun(script, runId);
				if (method === "POST") {
					if (!state.chapterIds.includes(id)) state.chapterIds.push(id);
				} else if (method === "DELETE") {
					state.chapterIds = state.chapterIds.filter((x) => x !== id);
				}
			}
			return new Response("{}", { status: 200 });
		}

		const keyChangeMatch = url.match(/\/api\/key-change-view\/(.+)$/);
		if (keyChangeMatch) {
			const id = decodeURIComponent(keyChangeMatch[1] ?? "");
			await maybeWaitGate(script, method, url);
			const runs = script.mutateRuns.length > 0 ? script.mutateRuns : Object.keys(script.viewState);
			for (const runId of runs) {
				const state = ensureRun(script, runId);
				if (method === "POST") {
					if (!state.keyChangeIds.includes(id)) state.keyChangeIds.push(id);
				} else if (method === "DELETE") {
					state.keyChangeIds = state.keyChangeIds.filter((x) => x !== id);
				}
			}
			return new Response("{}", { status: 200 });
		}

		return new Response("not found", { status: 404 });
	};

	vi.stubGlobal("fetch", vi.fn(fakeFetch));
}

function makeWrapper(): {
	client: QueryClient;
	Wrapper: ({ children }: { children: ReactNode }) => ReactElement;
} {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const Wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	return { client, Wrapper };
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("useViewState", () => {
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
			viewState: { run1: { chapterIds: ["chap-1"], keyChangeIds: [] } },
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
