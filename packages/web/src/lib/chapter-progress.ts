import type { Chapter } from "@stagereview/types/chapters";

export const CHAPTER_PROGRESS_MODE = {
	COMPACT: "compact",
	WITH_TITLES: "with-titles",
} as const;
export type ChapterProgressMode =
	(typeof CHAPTER_PROGRESS_MODE)[keyof typeof CHAPTER_PROGRESS_MODE];

export const CHAPTER_PROGRESS_MODE_OPTIONS: { value: ChapterProgressMode; label: string }[] = [
	{ value: CHAPTER_PROGRESS_MODE.COMPACT, label: "Compact" },
	{ value: CHAPTER_PROGRESS_MODE.WITH_TITLES, label: "With titles" },
];

export const CHAPTER_PROGRESS_MODE_STORAGE_KEY = "chapter-progressMode";

const CHAPTER_PROGRESS_MODES = new Set<string>(Object.values(CHAPTER_PROGRESS_MODE));

export function isChapterProgressMode(value: string): value is ChapterProgressMode {
	return CHAPTER_PROGRESS_MODES.has(value);
}

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
	let reviewedCount = 0;
	const items = [...chapters]
		.sort((a, b) => a.order - b.order)
		.map((chapter) => {
			const isReviewed = viewState.reviewedChapterIds.has(chapter.externalId);
			if (isReviewed) reviewedCount++;
			const status = isReviewed
				? CHAPTER_PROGRESS_STATUS.REVIEWED
				: viewState.visitedChapterIds.has(chapter.externalId)
					? CHAPTER_PROGRESS_STATUS.VISITED
					: CHAPTER_PROGRESS_STATUS.NOT_STARTED;
			return { chapter, status };
		});
	return { items, reviewedCount };
}
