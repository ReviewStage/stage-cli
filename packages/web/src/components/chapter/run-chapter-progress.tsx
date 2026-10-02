import { useMatchRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect } from "react";
import type { ProgressChapter } from "@/lib/chapter-progress";
import { useChapterViewState } from "@/lib/chapter-view-state-context";
import { useViewStateData } from "@/lib/use-view-state";
import { ChapterProgress } from "./chapter-progress";

export function RunChapterProgress({
	runId,
	chapters,
}: {
	runId: string;
	chapters: readonly ProgressChapter[];
}) {
	const chapterViewState = useChapterViewState();
	if (!chapterViewState) {
		throw new Error("RunChapterProgress must be used within a ChapterViewStateProvider");
	}
	const { visitedChapterIds, markChapterVisited, continuousChapterNavigationRef } =
		chapterViewState;
	const { chapterIdSet, isLoading, error } = useViewStateData(runId);
	const params = useParams({ strict: false });
	const matchRoute = useMatchRoute();
	const navigate = useNavigate();
	const isContinuousReader = Boolean(matchRoute({ to: "/runs/$runId/chapters" }));
	const activeChapterNumber = isContinuousReader
		? chapterViewState.activeContinuousChapterNumber
		: params.chapterNumber === undefined
			? null
			: Number.parseInt(params.chapterNumber, 10);
	const activeChapter = chapters.find((chapter) => chapter.order + 1 === activeChapterNumber);
	const activeExternalId = activeChapter?.externalId;

	useEffect(() => {
		if (activeExternalId !== undefined) markChapterVisited(activeExternalId);
	}, [activeExternalId, markChapterVisited]);

	const navigateToChapter = (chapterNumber: number) => {
		if (isContinuousReader && continuousChapterNavigationRef.current) {
			continuousChapterNavigationRef.current(chapterNumber);
			return;
		}
		void navigate({
			to: "/runs/$runId/chapters/$chapterNumber",
			params: { runId, chapterNumber: String(chapterNumber) },
			resetScroll: false,
		});
	};

	return (
		<ChapterProgress
			chapters={chapters}
			viewState={{ reviewedChapterIds: chapterIdSet, visitedChapterIds }}
			activeChapterNumber={activeChapterNumber}
			onNavigateToChapter={navigateToChapter}
			isLoading={isLoading}
			error={error}
		/>
	);
}
