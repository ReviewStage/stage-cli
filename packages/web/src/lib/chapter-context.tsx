import type { Chapter } from "@stagereview/types/chapters";
import { createContext, type ReactNode, use, useMemo } from "react";
import { filterFilesForChapter } from "./filter-files-for-chapter";
import { useChapters } from "./use-chapters";
import { useDiffPatch } from "./use-diff-patch";

export interface ChapterLineCounts {
	linesAdded: number;
	linesDeleted: number;
}

interface ChapterContextValue {
	runId: string;
	chapters: readonly Chapter[];
	chapterLineCountsMap: ReadonlyMap<string, ChapterLineCounts>;
}

const ChapterContext = createContext<ChapterContextValue | null>(null);

function buildChapterLineCountsMap(
	chapters: readonly Chapter[],
	patch: string | undefined,
): ReadonlyMap<string, ChapterLineCounts> {
	const map = new Map<string, ChapterLineCounts>();
	if (!patch) return map;
	for (const chapter of chapters) {
		const entries = filterFilesForChapter(patch, chapter.hunkRefs);
		let linesAdded = 0;
		let linesDeleted = 0;
		for (const entry of entries) {
			linesAdded += entry.file.additions;
			linesDeleted += entry.file.deletions;
		}
		map.set(chapter.id, { linesAdded, linesDeleted });
	}
	return map;
}

export function ChapterProvider({ runId, children }: { runId: string; children: ReactNode }) {
	const { data: chaptersData } = useChapters(runId);
	const { data: diffData } = useDiffPatch(runId);

	const chapters = useMemo<readonly Chapter[]>(() => {
		if (!chaptersData?.chapters) return [];
		return [...chaptersData.chapters].sort((a, b) => a.order - b.order);
	}, [chaptersData?.chapters]);

	const chapterLineCountsMap = useMemo(
		() => buildChapterLineCountsMap(chapters, diffData?.patch),
		[chapters, diffData?.patch],
	);

	const value = useMemo<ChapterContextValue>(
		() => ({ runId, chapters, chapterLineCountsMap }),
		[runId, chapters, chapterLineCountsMap],
	);

	return <ChapterContext value={value}>{children}</ChapterContext>;
}

export function useChapterContext(): ChapterContextValue {
	const ctx = use(ChapterContext);
	if (!ctx) {
		throw new Error("useChapterContext must be used within a ChapterProvider");
	}
	return ctx;
}
