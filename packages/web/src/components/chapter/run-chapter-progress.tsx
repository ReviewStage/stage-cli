import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect } from "react";
import { parseChapterNumber } from "@/lib/chapter-number";
import type { ProgressChapter } from "@/lib/chapter-progress";
import { useChapterVisits, useContinuousChapterReader } from "@/lib/chapter-view-state-context";
import { CHAPTER_VIEW_MODE, useChapterSettings } from "@/lib/use-chapter-settings";
import type { UseViewStateDataResult } from "@/lib/use-view-state";
import { ChapterProgress } from "./chapter-progress";

interface RunChapterProgressProps {
	runId: string;
	chapters: readonly ProgressChapter[];
	viewState: UseViewStateDataResult;
}

export function RunChapterProgress({ runId, chapters, viewState }: RunChapterProgressProps) {
	const { visitedChapterIds, markChapterVisited } = useChapterVisits();
	const { chapterViewMode } = useChapterSettings();
	const continuousReader = useContinuousChapterReader();
	const params = useParams({ strict: false });
	const navigate = useNavigate();

	const isContinuous = chapterViewMode === CHAPTER_VIEW_MODE.CONTINUOUS;
	const activeChapterNumber = isContinuous
		? (continuousReader?.activeChapterNumber ?? null)
		: params.chapterNumber === undefined
			? null
			: parseChapterNumber(params.chapterNumber);
	const activeExternalId = chapters.find(
		(chapter) => chapter.order + 1 === activeChapterNumber,
	)?.externalId;

	useEffect(() => {
		if (activeExternalId !== undefined) markChapterVisited(activeExternalId);
	}, [activeExternalId, markChapterVisited]);

	// Continuous mode steers the mounted stream in place; routing to
	// /chapters/N there would remount the whole reader. Until the stream has
	// loaded there is nothing to steer, so the strip is not navigable yet.
	const navigateToChapter = isContinuous
		? (continuousReader?.navigateToChapter ?? null)
		: (chapterNumber: number) => {
				void navigate({
					to: "/runs/$runId/chapters/$chapterNumber",
					params: { runId, chapterNumber: String(chapterNumber) },
					resetScroll: false,
				});
			};

	return (
		<ChapterProgress
			chapters={chapters}
			viewState={{ reviewedChapterIds: viewState.chapterIdSet, visitedChapterIds }}
			activeChapterNumber={activeChapterNumber}
			onNavigateToChapter={navigateToChapter}
			isLoading={viewState.isLoading}
			error={viewState.error}
		/>
	);
}
