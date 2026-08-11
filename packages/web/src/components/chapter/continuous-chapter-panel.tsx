import type { Chapter } from "@stagereview/types/chapters";
import { Circle, CircleCheck } from "lucide-react";
import type { CSSProperties } from "react";
import { ShortcutTooltip } from "@/components/shared/shortcut-tooltip";
import { Button } from "@/components/ui/button";
import { useChapterContext } from "@/lib/chapter-context";
import type { PullRequestFile } from "@/lib/diff-types";
import { SHORTCUT_KEY } from "@/lib/keyboard-shortcuts";
import { PANEL_POSITION, type PanelPosition } from "@/lib/use-chapter-settings";
import { cn } from "@/lib/utils";
import { ChapterActionsMenu } from "./chapter-actions-menu";
import { ChapterFileList } from "./chapter-file-list";
import { ChapterSummary } from "./chapter-summary";
import { ChapterTitleBlock } from "./chapter-title-block";

interface ContinuousChapterPanelProps {
	chapter: Chapter;
	files: PullRequestFile[];
	chapterNumber: number;
	totalChapters: number;
	isActive: boolean;
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
}

function formatChapterOrdinal(value: number): string {
	return String(value).padStart(2, "0");
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
	totalChapters,
	isActive,
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
}: ContinuousChapterPanelProps) {
	const { chapterLineCountsMap, chapterCommentCounts } = useChapterContext();

	const counts = chapterLineCountsMap.get(chapter.id) ?? null;
	const commentCount = chapterCommentCounts.get(chapter.id) ?? 0;
	const isViewed = viewedChapterIds.has(chapter.externalId);

	const viewedToggle = (
		<Button
			variant="ghost"
			size="sm"
			className={cn(
				"h-7 shrink-0 cursor-pointer gap-1.5 px-2",
				isViewed
					? "text-green-600 hover:text-green-700 dark:text-green-500 dark:hover:text-green-400"
					: "text-muted-foreground hover:text-foreground",
			)}
			onClick={() => onToggleChapterViewed(chapter)}
			aria-label={isViewed ? "Unmark as viewed" : "Mark as viewed"}
		>
			{isViewed ? <CircleCheck className="size-4" /> : <Circle className="size-4" />}
			Reviewed
		</Button>
	);

	const header = (
		<div className="shrink-0 border-border border-b">
			<div className="flex items-center gap-1 py-3 pl-[var(--panel-pl,2rem)] pr-[var(--panel-pr,1rem)]">
				<span className="font-medium text-muted-foreground text-xs tabular-nums">
					{formatChapterOrdinal(chapterNumber)}/{formatChapterOrdinal(totalChapters)}
				</span>
				<div className="-mr-1.5 ml-auto flex items-center gap-1">
					{isActive ? (
						<ShortcutTooltip
							shortcutKey={SHORTCUT_KEY.MARK_CHAPTER_AS_VIEWED}
							label={isViewed ? "Unmark as viewed" : "Mark as viewed"}
						>
							{viewedToggle}
						</ShortcutTooltip>
					) : (
						viewedToggle
					)}
					<ChapterActionsMenu onCopyChapter={onCopyChapter} />
				</div>
			</div>
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
				"sticky top-[var(--content-top)] flex max-h-[calc(var(--main-height)_-_var(--content-top))] w-[clamp(280px,30vw,50vw)] shrink-0 flex-col bg-card/30",
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
