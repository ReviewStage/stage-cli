// Shared fetch + QueryClient fixtures for useViewState tests. Lives in
// __tests__/ as a sibling of the test files so the cross-file scope rule
// (per-file mock budget) stays obvious.

import type { ViewState } from "@stage-cli/types/view-state";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { vi } from "vitest";

interface FetchCall {
	url: string;
	method: string;
}

export interface FetchScript {
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

export function makeFetchScript(over: Partial<FetchScript> = {}): FetchScript {
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
export function gate(script: FetchScript, method: string, url: string): () => void {
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

export function installFetch(script: FetchScript): void {
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

export function makeWrapper(): {
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
