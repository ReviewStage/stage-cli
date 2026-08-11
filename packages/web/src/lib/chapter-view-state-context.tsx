import type { ReactNode } from "react";
import { createContext, useContext, useMemo, useState } from "react";

interface ChapterViewStateContextValue {
	activeContinuousChapterNumber: number;
	setActiveContinuousChapterNumber: (chapterNumber: number) => void;
}

const ChapterViewStateContext = createContext<ChapterViewStateContextValue | null>(null);

export function ChapterViewStateProvider({ children }: { children: ReactNode }) {
	const [activeContinuousChapterNumber, setActiveContinuousChapterNumber] = useState(1);
	const value = useMemo(
		() => ({
			activeContinuousChapterNumber,
			setActiveContinuousChapterNumber,
		}),
		[activeContinuousChapterNumber],
	);

	return <ChapterViewStateContext value={value}>{children}</ChapterViewStateContext>;
}

export function useChapterViewState(): ChapterViewStateContextValue | null {
	return useContext(ChapterViewStateContext);
}
