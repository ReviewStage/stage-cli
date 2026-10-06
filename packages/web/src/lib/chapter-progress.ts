import type { Chapter } from "@stagereview/types/chapters";
import { countViewedChapters } from "./use-view-state";

export const CHAPTER_PROGRESS_STATUS = {
	NOT_STARTED: "not-started",
	VISITED: "visited",
	REVIEWED: "reviewed",
} as const;
export type ChapterProgressStatus =
	(typeof CHAPTER_PROGRESS_STATUS)[keyof typeof CHAPTER_PROGRESS_STATUS];

export const CHAPTER_PROGRESS_LABELS = {
	[CHAPTER_PROGRESS_STATUS.NOT_STARTED]: "Not started",
	[CHAPTER_PROGRESS_STATUS.VISITED]: "Visited",
	[CHAPTER_PROGRESS_STATUS.REVIEWED]: "Reviewed",
} as const satisfies Record<ChapterProgressStatus, string>;

export type ProgressChapter = Pick<Chapter, "id" | "externalId" | "order" | "title">;

export interface ChapterProgressViewState {
	reviewedChapterIds: ReadonlySet<string>;
	visitedChapterIds: ReadonlySet<string>;
}

export function buildChapterProgress(
	chapters: readonly ProgressChapter[],
	viewState: ChapterProgressViewState,
) {
	const items = [...chapters]
		.sort((a, b) => a.order - b.order)
		.map((chapter) => {
			const status = viewState.reviewedChapterIds.has(chapter.externalId)
				? CHAPTER_PROGRESS_STATUS.REVIEWED
				: viewState.visitedChapterIds.has(chapter.externalId)
					? CHAPTER_PROGRESS_STATUS.VISITED
					: CHAPTER_PROGRESS_STATUS.NOT_STARTED;
			return { chapter, status };
		});
	return { items, reviewedCount: countViewedChapters(chapters, viewState.reviewedChapterIds) };
}
