import type { Chapter } from "@stagereview/types/chapters";
import { type CSSProperties, useMemo } from "react";
import { useChapterContext } from "@/lib/chapter-context";
import { buildChapterCommentCountsMap } from "@/lib/comment-counts";
import type { PullRequestFile } from "@/lib/diff-types";
import { useReviewContext } from "@/lib/review-context";
import { PANEL_POSITION, type PanelPosition } from "@/lib/use-chapter-settings";
import { RESIZE_HANDLE_SIDE, useResizablePanel } from "@/lib/use-resizable-panel";
import { cn } from "@/lib/utils";
import { ChapterFileList } from "./chapter-file-list";
import { ChapterNavigator } from "./chapter-navigator";
import {
	CHAPTER_PANEL_MAX_WIDTH_FRACTION,
	CHAPTER_PANEL_MIN_WIDTH,
	resolveChapterPanelDefaultWidth,
	resolveChapterPanelMaxWidth,
} from "./chapter-panel-constants";
import { ChapterSummary } from "./chapter-summary";
import { ChapterTitleBlock } from "./chapter-title-block";

interface ChapterSidePanelProps {
	chapter: Chapter;
	chapterIndex: number;
	files: PullRequestFile[];
	focusedFilePath?: string;
	viewedChapterIds: ReadonlySet<string>;
	checkedKeyChangeIds: ReadonlySet<string>;
	viewedFilePathSet: ReadonlySet<string>;
	focusedKeyChangeId: string | null;
	position?: PanelPosition;
	onToggleChapterViewed: (externalId: string) => void;
	onToggleKeyChangeChecked: (keyChangeId: string) => void;
	onToggleFileViewed: (filePath: string) => void;
	onFocusKeyChange: (keyChangeId: string | null) => void;
	onSelectFile: (filePath: string) => void;
	onCopyChapter: () => void;
}

export function ChapterSidePanel({
	chapter,
	chapterIndex,
	files,
	focusedFilePath,
	viewedChapterIds,
	checkedKeyChangeIds,
	viewedFilePathSet,
	focusedKeyChangeId,
	position = PANEL_POSITION.LEFT,
	onToggleChapterViewed,
	onToggleKeyChangeChecked,
	onToggleFileViewed,
	onFocusKeyChange,
	onSelectFile,
	onCopyChapter,
}: ChapterSidePanelProps) {
	const { chapters: allChapters, chapterLineCountsMap } = useChapterContext();
	const { threads } = useReviewContext();

	const counts = chapterLineCountsMap.get(chapter.id) ?? null;
	const chapterCommentCounts = useMemo(
		() => buildChapterCommentCountsMap(allChapters, threads),
		[allChapters, threads],
	);
	const commentCount = chapterCommentCounts.get(chapter.id) ?? 0;

	const isTop = position === PANEL_POSITION.TOP;
	const isRight = position === PANEL_POSITION.RIGHT;

	const { width, panelRef, resizeHandleProps } = useResizablePanel({
		minWidth: CHAPTER_PANEL_MIN_WIDTH,
		maxWidth: resolveChapterPanelMaxWidth,
		defaultWidth: resolveChapterPanelDefaultWidth,
		handleSide: isRight ? RESIZE_HANDLE_SIDE.LEFT : RESIZE_HANDLE_SIDE.RIGHT,
	});

	const header = (
		<div className="shrink-0 border-border border-b">
			<ChapterNavigator
				chapter={chapter}
				chapterIndex={chapterIndex}
				viewedChapterIds={viewedChapterIds}
				chapterCommentCounts={chapterCommentCounts}
				onToggleViewed={onToggleChapterViewed}
				onCopyChapter={onCopyChapter}
			/>
			<ChapterTitleBlock chapter={chapter} counts={counts} commentCount={commentCount} />
		</div>
	);

	const content = (
		<>
			<ChapterSummary
				chapter={chapter}
				checkedKeyChangeIds={checkedKeyChangeIds}
				focusedKeyChangeId={focusedKeyChangeId}
				onToggleKeyChangeChecked={onToggleKeyChangeChecked}
				onFocusKeyChange={onFocusKeyChange}
			/>
			<div className="border-border border-t">
				<ChapterFileList
					files={files}
					focusedFilePath={focusedFilePath}
					viewedPathSet={viewedFilePathSet}
					onToggleFileViewed={onToggleFileViewed}
					onSelectFile={onSelectFile}
				/>
			</div>
		</>
	);

	if (isTop) {
		return (
			<div
				data-chapter-side-panel
				className="mx-auto max-w-3xl px-6 pb-4 lg:px-0"
				style={{ "--panel-pl": "0px", "--panel-pr": "0px" } as CSSProperties}
			>
				{header}
				{content}
			</div>
		);
	}

	return (
		<div
			ref={panelRef}
			data-chapter-side-panel
			className={cn(
				"sticky top-[var(--content-top)] flex h-[calc(var(--main-height)_-_var(--content-top))] flex-col bg-card/30",
				isRight ? "border-border border-l" : "border-border border-r",
			)}
			style={
				{
					width,
					minWidth: CHAPTER_PANEL_MIN_WIDTH,
					maxWidth: `${CHAPTER_PANEL_MAX_WIDTH_FRACTION * 100}vw`,
					"--panel-pl": isRight ? "1rem" : "2rem",
					"--panel-pr": isRight ? "2rem" : "1rem",
				} as CSSProperties
			}
		>
			<div className="flex min-h-0 flex-1 flex-col">
				{header}
				<div className="scrollbar-thin flex-1 overflow-y-auto">{content}</div>
			</div>
			<div
				{...resizeHandleProps}
				className={cn(
					"absolute top-0 z-10 h-full w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50",
					isRight ? "left-0" : "right-0",
				)}
			/>
		</div>
	);
}
