import type { Chapter } from "@stagereview/types/chapters";
import type { CSSProperties } from "react";
import { useChapterContext } from "@/lib/chapter-context";
import type { PullRequestFile } from "@/lib/diff-types";
import { PANEL_POSITION, type PanelPosition } from "@/lib/use-chapter-settings";
import { cn } from "@/lib/utils";
import { ChapterFileList } from "./chapter-file-list";
import { ChapterNavigator } from "./chapter-navigator";
import { ChapterSummary } from "./chapter-summary";
import { ChapterTitleBlock } from "./chapter-title-block";

interface ContinuousChapterPanelProps {
	chapter: Chapter;
	files: PullRequestFile[];
	chapterNumber: number;
	position: PanelPosition;
	focusedFilePath: string | undefined;
	viewedChapterIds: ReadonlySet<string>;
	checkedKeyChangeIds: ReadonlySet<string>;
	viewedFilePathSet: ReadonlySet<string>;
	focusedKeyChangeId: string | null;
	onToggleChapterViewed: (chapter: Chapter) => void;
	onToggleKeyChangeChecked: (keyChangeId: string) => void;
	onToggleFileViewed: (filePath: string) => void;
	onFocusKeyChange: (keyChangeId: string | null) => void;
	onSelectFile: (filePath: string) => void;
	onCopyChapter: () => void;
	onNavigateToChapter: (chapterNumber: number) => void;
}

/**
 * Per-chapter narrative column for the continuous view. In the side layouts it is sticky
 * within its chapter section: it pins at the content top while the chapter's
 * diffs scroll, then scrolls away past the chapter's last diff as the next
 * chapter's panel scrolls in.
 */
export function ContinuousChapterPanel({
	chapter,
	files,
	chapterNumber,
	position,
	focusedFilePath,
	viewedChapterIds,
	checkedKeyChangeIds,
	viewedFilePathSet,
	focusedKeyChangeId,
	onToggleChapterViewed,
	onToggleKeyChangeChecked,
	onToggleFileViewed,
	onFocusKeyChange,
	onSelectFile,
	onCopyChapter,
	onNavigateToChapter,
}: ContinuousChapterPanelProps) {
	const { chapterLineCountsMap, chapterCommentCounts } = useChapterContext();

	const counts = chapterLineCountsMap.get(chapter.id) ?? null;
	const commentCount = chapterCommentCounts.get(chapter.id) ?? 0;

	const header = (
		<div className="shrink-0 border-border border-b">
			<ChapterNavigator
				chapter={chapter}
				chapterIndex={chapterNumber - 1}
				viewedChapterIds={viewedChapterIds}
				chapterCommentCounts={chapterCommentCounts}
				onToggleViewed={() => onToggleChapterViewed(chapter)}
				onCopyChapter={onCopyChapter}
				onNavigateToChapter={onNavigateToChapter}
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

	if (position === PANEL_POSITION.TOP) {
		return (
			<div
				data-chapter-panel
				className="mx-auto max-w-3xl px-6 pb-4 lg:px-0"
				style={{ "--panel-pl": "0px", "--panel-pr": "0px" } as CSSProperties}
			>
				{header}
				{content}
			</div>
		);
	}

	const isRight = position === PANEL_POSITION.RIGHT;

	return (
		<div
			data-chapter-panel
			className={cn(
				"sticky top-[var(--content-top)] flex max-h-[calc(var(--main-height)_-_var(--content-top))] w-[clamp(280px,30vw,50vw)] shrink-0 flex-col",
				isRight ? "border-border border-l" : "border-border border-r",
			)}
			style={
				{
					"--panel-pl": isRight ? "1rem" : "2rem",
					"--panel-pr": isRight ? "2rem" : "1rem",
				} as CSSProperties
			}
		>
			{header}
			<div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">{content}</div>
		</div>
	);
}
