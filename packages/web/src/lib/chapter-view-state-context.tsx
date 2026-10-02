import type { ReactNode, RefObject } from "react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

interface ChapterViewStateContextValue {
	activeContinuousChapterNumber: number | null;
	setActiveContinuousChapterNumber: (chapterNumber: number) => void;
	continuousChapterNavigationRef: RefObject<((chapterNumber: number) => void) | null>;
	visitedChapterIds: ReadonlySet<string>;
	markChapterVisited: (externalId: string) => void;
}

const ChapterViewStateContext = createContext<ChapterViewStateContextValue | null>(null);

export function ChapterViewStateProvider({ children }: { children: ReactNode }) {
	const [activeContinuousChapterNumber, setActiveContinuousChapterNumber] = useState<number | null>(
		null,
	);
	const continuousChapterNavigationRef = useRef<((chapterNumber: number) => void) | null>(null);
	const [visitedChapterIds, setVisitedChapterIds] = useState<ReadonlySet<string>>(new Set());
	const markChapterVisited = useCallback((externalId: string) => {
		setVisitedChapterIds((previous) => {
			if (previous.has(externalId)) return previous;
			return new Set([...previous, externalId]);
		});
	}, []);
	const value = useMemo(
		() => ({
			activeContinuousChapterNumber,
			setActiveContinuousChapterNumber,
			continuousChapterNavigationRef,
			visitedChapterIds,
			markChapterVisited,
		}),
		[activeContinuousChapterNumber, visitedChapterIds, markChapterVisited],
	);

	return <ChapterViewStateContext value={value}>{children}</ChapterViewStateContext>;
}

export function useChapterViewState(): ChapterViewStateContextValue | null {
	return useContext(ChapterViewStateContext);
}
