// @vitest-environment happy-dom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChapterViewStateProvider, useChapterViewState } from "../chapter-view-state-context";

afterEach(cleanup);

describe("chapter visits", () => {
	it("retains visits while moving between chapters in the run", () => {
		const { result } = renderHook(useChapterViewState, { wrapper: ChapterViewStateProvider });

		act(() => {
			result.current?.markChapterVisited("first");
			result.current?.markChapterVisited("second");
			result.current?.markChapterVisited("first");
		});

		expect(result.current?.visitedChapterIds).toEqual(new Set(["first", "second"]));
	});

	it("starts a new run without visits or a stale continuous chapter", () => {
		const first = renderHook(useChapterViewState, { wrapper: ChapterViewStateProvider });
		act(() => {
			first.result.current?.markChapterVisited("first");
			first.result.current?.setActiveContinuousChapterNumber(4);
		});
		first.unmount();

		const second = renderHook(useChapterViewState, { wrapper: ChapterViewStateProvider });

		expect(second.result.current?.visitedChapterIds.size).toBe(0);
		expect(second.result.current?.activeContinuousChapterNumber).toBeNull();
	});
});
