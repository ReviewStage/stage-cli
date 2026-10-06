import type { Context, ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * The mounted continuous reader's position. `navigateToChapter` is null while
 * the reader is still loading — the position is already known (the deep-linked
 * chapter) but there is no stream to scroll yet.
 */
export interface ContinuousChapterReader {
	activeChapterNumber: number;
	navigateToChapter: ((chapterNumber: number) => void) | null;
}

interface ChapterVisits {
	visitedChapterIds: ReadonlySet<string>;
	markChapterVisited: (externalId: string) => void;
}

const ContinuousChapterReaderContext = createContext<ContinuousChapterReader | null>(null);
// The setter lives in its own context so the publishing reader doesn't
// re-render every time its own published position changes.
const PublishContinuousChapterReaderContext = createContext<
	((reader: ContinuousChapterReader | null) => void) | null
>(null);
const ChapterVisitsContext = createContext<ChapterVisits | null>(null);

export function ChapterViewStateProvider({ children }: { children: ReactNode }) {
	const [continuousReader, setContinuousReader] = useState<ContinuousChapterReader | null>(null);
	const [visitedChapterIds, setVisitedChapterIds] = useState<ReadonlySet<string>>(new Set());
	const markChapterVisited = useCallback((externalId: string) => {
		setVisitedChapterIds((previous) => {
			if (previous.has(externalId)) return previous;
			return new Set([...previous, externalId]);
		});
	}, []);
	const visits = useMemo(
		() => ({ visitedChapterIds, markChapterVisited }),
		[visitedChapterIds, markChapterVisited],
	);

	return (
		<PublishContinuousChapterReaderContext value={setContinuousReader}>
			<ContinuousChapterReaderContext value={continuousReader}>
				<ChapterVisitsContext value={visits}>{children}</ChapterVisitsContext>
			</ContinuousChapterReaderContext>
		</PublishContinuousChapterReaderContext>
	);
}

function useRequiredContext<T>(context: Context<T | null>, hookName: string): T {
	const value = useContext(context);
	if (value === null) {
		throw new Error(`${hookName} must be used within a ChapterViewStateProvider`);
	}
	return value;
}

/** The mounted continuous reader, or null when no continuous reader is mounted. */
export function useContinuousChapterReader(): ContinuousChapterReader | null {
	useRequiredContext(PublishContinuousChapterReaderContext, "useContinuousChapterReader");
	return useContext(ContinuousChapterReaderContext);
}

/** Publishes the calling reader's position for as long as it stays mounted. */
export function usePublishContinuousChapterReader(reader: ContinuousChapterReader) {
	const publish = useRequiredContext(
		PublishContinuousChapterReaderContext,
		"usePublishContinuousChapterReader",
	);
	useEffect(() => {
		publish(reader);
		return () => publish(null);
	}, [publish, reader]);
}

export function useChapterVisits(): ChapterVisits {
	return useRequiredContext(ChapterVisitsContext, "useChapterVisits");
}
