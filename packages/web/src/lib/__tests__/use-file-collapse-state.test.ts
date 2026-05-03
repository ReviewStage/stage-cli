// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFileCollapseState } from "../use-file-collapse-state";

const EMPTY_DEFAULTS = new Set<string>();
const RESET_KEY = "owner/repo/1";

describe("useFileCollapseState — basic operations", () => {
	describe("initial state", () => {
		it("collapses only default-collapsed files", () => {
			const defaults = new Set(["deleted.ts"]);
			const allPaths = ["a.ts", "b.ts", "deleted.ts"];
			const { result } = renderHook(() => useFileCollapseState(defaults, allPaths, RESET_KEY));
			expect(result.current.collapsedFiles).toEqual(new Set(["deleted.ts"]));
		});

		it("starts with no files collapsed when there are no defaults", () => {
			const allPaths = ["a.ts", "b.ts"];
			const { result } = renderHook(() =>
				useFileCollapseState(EMPTY_DEFAULTS, allPaths, RESET_KEY),
			);
			expect(result.current.collapsedFiles.size).toBe(0);
		});
	});

	describe("toggleFileCollapsed", () => {
		it("collapses a non-default file", () => {
			const allPaths = ["a.ts", "b.ts"];
			const { result } = renderHook(() =>
				useFileCollapseState(EMPTY_DEFAULTS, allPaths, RESET_KEY),
			);
			act(() => result.current.toggleFileCollapsed("a.ts"));
			expect(result.current.collapsedFiles).toEqual(new Set(["a.ts"]));
		});

		it("un-collapses a toggled file on second toggle", () => {
			const allPaths = ["a.ts"];
			const { result } = renderHook(() =>
				useFileCollapseState(EMPTY_DEFAULTS, allPaths, RESET_KEY),
			);
			act(() => result.current.toggleFileCollapsed("a.ts"));
			act(() => result.current.toggleFileCollapsed("a.ts"));
			expect(result.current.collapsedFiles.size).toBe(0);
		});

		it("expands a default-collapsed file", () => {
			const defaults = new Set(["deleted.ts"]);
			const allPaths = ["a.ts", "deleted.ts"];
			const { result } = renderHook(() => useFileCollapseState(defaults, allPaths, RESET_KEY));
			act(() => result.current.toggleFileCollapsed("deleted.ts"));
			expect(result.current.collapsedFiles.has("deleted.ts")).toBe(false);
		});
	});

	describe("collapseAllFiles", () => {
		it("collapses all files when none are collapsed", () => {
			const allPaths = ["a.ts", "b.ts", "c.ts"];
			const { result } = renderHook(() =>
				useFileCollapseState(EMPTY_DEFAULTS, allPaths, RESET_KEY),
			);
			act(() => result.current.collapseAllFiles());
			expect(result.current.collapsedFiles).toEqual(new Set(["a.ts", "b.ts", "c.ts"]));
		});

		it("collapses all files when some are already default-collapsed", () => {
			const defaults = new Set(["deleted.ts"]);
			const allPaths = ["a.ts", "b.ts", "deleted.ts"];
			const { result } = renderHook(() => useFileCollapseState(defaults, allPaths, RESET_KEY));
			act(() => result.current.collapseAllFiles());
			expect(result.current.collapsedFiles).toEqual(new Set(["a.ts", "b.ts", "deleted.ts"]));
		});

		it("collapses all files even after some were manually expanded", () => {
			const defaults = new Set(["deleted.ts"]);
			const allPaths = ["a.ts", "deleted.ts"];
			const { result } = renderHook(() => useFileCollapseState(defaults, allPaths, RESET_KEY));
			act(() => result.current.toggleFileCollapsed("deleted.ts"));
			act(() => result.current.collapseAllFiles());
			expect(result.current.collapsedFiles).toEqual(new Set(["a.ts", "deleted.ts"]));
		});

		it("is a no-op when all files are already collapsed", () => {
			const allPaths = ["a.ts"];
			const { result } = renderHook(() =>
				useFileCollapseState(EMPTY_DEFAULTS, allPaths, RESET_KEY),
			);
			act(() => result.current.collapseAllFiles());
			const first = result.current.collapsedFiles;
			act(() => result.current.collapseAllFiles());
			expect(result.current.collapsedFiles).toEqual(first);
		});
	});

	describe("expandAllFiles", () => {
		it("expands all files when all are collapsed", () => {
			const allPaths = ["a.ts", "b.ts"];
			const { result } = renderHook(() =>
				useFileCollapseState(EMPTY_DEFAULTS, allPaths, RESET_KEY),
			);
			act(() => result.current.collapseAllFiles());
			act(() => result.current.expandAllFiles());
			expect(result.current.collapsedFiles.size).toBe(0);
		});

		it("expands all files including default-collapsed ones", () => {
			const defaults = new Set(["deleted.ts"]);
			const allPaths = ["a.ts", "deleted.ts"];
			const { result } = renderHook(() => useFileCollapseState(defaults, allPaths, RESET_KEY));
			act(() => result.current.expandAllFiles());
			expect(result.current.collapsedFiles.size).toBe(0);
		});

		it("expands all after a mix of manual toggles", () => {
			const defaults = new Set(["deleted.ts"]);
			const allPaths = ["a.ts", "b.ts", "deleted.ts"];
			const { result } = renderHook(() => useFileCollapseState(defaults, allPaths, RESET_KEY));
			act(() => result.current.toggleFileCollapsed("a.ts"));
			act(() => result.current.toggleFileCollapsed("deleted.ts"));
			act(() => result.current.expandAllFiles());
			expect(result.current.collapsedFiles.size).toBe(0);
		});
	});
});

describe("useFileCollapseState — advanced behaviors", () => {
	describe("resetKey", () => {
		it("clears overrides when resetKey changes", () => {
			const allPaths = ["a.ts", "b.ts"];
			let resetKey = "owner/repo/1";
			const { result, rerender } = renderHook(() =>
				useFileCollapseState(EMPTY_DEFAULTS, allPaths, resetKey),
			);

			act(() => result.current.toggleFileCollapsed("a.ts"));
			expect(result.current.collapsedFiles).toEqual(new Set(["a.ts"]));

			resetKey = "owner/repo/2";
			rerender();

			expect(result.current.collapsedFiles.size).toBe(0);
		});
	});

	describe("default changes reconcile overrides", () => {
		it("keeps a manually-collapsed file collapsed when it becomes default-collapsed", () => {
			const allPaths = ["a.ts", "b.ts"];
			let defaults: ReadonlySet<string> = new Set<string>();
			const { result, rerender } = renderHook(() =>
				useFileCollapseState(defaults, allPaths, RESET_KEY),
			);

			act(() => result.current.toggleFileCollapsed("a.ts"));
			expect(result.current.collapsedFiles.has("a.ts")).toBe(true);

			defaults = new Set(["a.ts"]);
			rerender();

			expect(result.current.collapsedFiles.has("a.ts")).toBe(true);
		});

		it("keeps a manually-expanded file expanded when it leaves defaults", () => {
			const allPaths = ["a.ts", "b.ts"];
			let defaults: ReadonlySet<string> = new Set(["a.ts"]);
			const { result, rerender } = renderHook(() =>
				useFileCollapseState(defaults, allPaths, RESET_KEY),
			);

			act(() => result.current.toggleFileCollapsed("a.ts"));
			expect(result.current.collapsedFiles.has("a.ts")).toBe(false);

			defaults = new Set<string>();
			rerender();

			expect(result.current.collapsedFiles.has("a.ts")).toBe(false);
		});

		it("preserves overrides for files whose default status did not change", () => {
			const allPaths = ["a.ts", "b.ts"];
			let defaults: ReadonlySet<string> = new Set<string>();
			const { result, rerender } = renderHook(() =>
				useFileCollapseState(defaults, allPaths, RESET_KEY),
			);

			act(() => result.current.toggleFileCollapsed("a.ts"));
			act(() => result.current.toggleFileCollapsed("b.ts"));

			defaults = new Set(["a.ts"]);
			rerender();

			expect(result.current.collapsedFiles.has("a.ts")).toBe(true);
			expect(result.current.collapsedFiles.has("b.ts")).toBe(true);
		});
	});

	describe("collapse then expand round-trip", () => {
		it("returns to fully expanded state after collapse-all then expand-all", () => {
			const defaults = new Set(["deleted.ts"]);
			const allPaths = ["a.ts", "b.ts", "deleted.ts"];
			const { result } = renderHook(() => useFileCollapseState(defaults, allPaths, RESET_KEY));

			act(() => result.current.collapseAllFiles());
			expect(result.current.collapsedFiles.size).toBe(3);

			act(() => result.current.expandAllFiles());
			expect(result.current.collapsedFiles.size).toBe(0);
		});
	});
});
