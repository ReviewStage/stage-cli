// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useHashRunId } from "../use-hash-run-id";

afterEach(() => {
	window.location.hash = "";
});

function setHash(next: string): void {
	// Manually fire hashchange after assigning — happy-dom's location setter
	// doesn't dispatch the event the way real browsers do across all paths.
	window.location.hash = next;
	window.dispatchEvent(new Event("hashchange"));
}

describe("useHashRunId", () => {
	it("parses the runId out of `#/runs/{runId}`", () => {
		window.location.hash = "#/runs/abc-123";
		const { result } = renderHook(() => useHashRunId());
		expect(result.current).toBe("abc-123");
	});

	it("re-renders when the hash changes", () => {
		window.location.hash = "#/runs/first";
		const { result } = renderHook(() => useHashRunId());
		expect(result.current).toBe("first");

		act(() => {
			setHash("#/runs/second");
		});
		expect(result.current).toBe("second");

		act(() => {
			setHash("");
		});
		expect(result.current).toBeNull();
	});

	it("returns null when the hash doesn't match the expected shape", () => {
		window.location.hash = "#/something-else";
		const { result } = renderHook(() => useHashRunId());
		expect(result.current).toBeNull();
	});

	it("decodes percent-encoded runIds", () => {
		window.location.hash = "#/runs/run%20with%20spaces";
		const { result } = renderHook(() => useHashRunId());
		expect(result.current).toBe("run with spaces");
	});

	it("ignores nested path segments after the runId", () => {
		// Anticipates a future `#/runs/abc/chapters/3` shape — the runId stays
		// accessible while the rest is parsed by a dedicated nested-route hook.
		window.location.hash = "#/runs/abc/chapters/3";
		const { result } = renderHook(() => useHashRunId());
		expect(result.current).toBe("abc");
	});
});
