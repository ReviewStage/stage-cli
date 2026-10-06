// @vitest-environment happy-dom

import { act, cleanup, render, renderHook } from "@testing-library/react";
import { useMemo } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
	ChapterViewStateProvider,
	useChapterVisits,
	useContinuousChapterReader,
	usePublishContinuousChapterReader,
} from "../chapter-view-state-context";

afterEach(cleanup);

describe("chapter visits", () => {
	it("retains visits while moving between chapters in the run", () => {
		const { result } = renderHook(useChapterVisits, { wrapper: ChapterViewStateProvider });

		act(() => {
			result.current.markChapterVisited("first");
			result.current.markChapterVisited("second");
			result.current.markChapterVisited("first");
		});

		expect(result.current.visitedChapterIds).toEqual(new Set(["first", "second"]));
	});

	it("starts a new run without visits", () => {
		const first = renderHook(useChapterVisits, { wrapper: ChapterViewStateProvider });
		act(() => first.result.current.markChapterVisited("first"));
		first.unmount();

		const second = renderHook(useChapterVisits, { wrapper: ChapterViewStateProvider });

		expect(second.result.current.visitedChapterIds.size).toBe(0);
	});

	it("fails loudly outside the provider", () => {
		expect(() => renderHook(useChapterVisits)).toThrow(/ChapterViewStateProvider/);
	});
});

describe("continuous chapter reader", () => {
	function Reader({ chapterNumber }: { chapterNumber: number }) {
		usePublishContinuousChapterReader(
			useMemo(
				() => ({ activeChapterNumber: chapterNumber, navigateToChapter: null }),
				[chapterNumber],
			),
		);
		return null;
	}

	function Harness({ readerChapter }: { readerChapter: number | null }) {
		const reader = useContinuousChapterReader();
		return (
			<>
				{readerChapter !== null && <Reader chapterNumber={readerChapter} />}
				<output>{reader === null ? "none" : reader.activeChapterNumber}</output>
			</>
		);
	}

	it("exposes the mounted reader's position and clears it on unmount", () => {
		const { container, rerender } = render(
			<ChapterViewStateProvider>
				<Harness readerChapter={2} />
			</ChapterViewStateProvider>,
		);
		expect(container.textContent).toBe("2");

		rerender(
			<ChapterViewStateProvider>
				<Harness readerChapter={5} />
			</ChapterViewStateProvider>,
		);
		expect(container.textContent).toBe("5");

		rerender(
			<ChapterViewStateProvider>
				<Harness readerChapter={null} />
			</ChapterViewStateProvider>,
		);
		expect(container.textContent).toBe("none");
	});
});
