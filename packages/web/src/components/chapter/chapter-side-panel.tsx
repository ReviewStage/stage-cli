import type { Chapter } from "@stagereview/types/chapters";
import { LineCounts } from "@/components/shared/line-counts";
import { Markdown } from "@/components/ui/markdown";
import { useChapterContext } from "@/lib/chapter-context";
import type { PullRequestFile } from "@/lib/diff-types";
import { useResizablePanel } from "@/lib/use-resizable-panel";
import { ChapterFileList } from "./chapter-file-list";
import { ChapterNavigator } from "./chapter-navigator";
import {
	CHAPTER_PANEL_MAX_WIDTH_FRACTION,
	CHAPTER_PANEL_MIN_WIDTH,
	resolveChapterPanelDefaultWidth,
	resolveChapterPanelMaxWidth,
} from "./chapter-panel-constants";
import { ChapterSummary } from "./chapter-summary";

interface ChapterSidePanelProps {
	chapter: Chapter;
	chapterIndex: number;
	files: PullRequestFile[];
	focusedFilePath?: string;
	viewedChapterIds: ReadonlySet<string>;
	checkedKeyChangeIds: ReadonlySet<string>;
	viewedFilePathSet: ReadonlySet<string>;
	focusedKeyChangeId: string | null;
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
	onToggleChapterViewed,
	onToggleKeyChangeChecked,
	onToggleFileViewed,
	onFocusKeyChange,
	onSelectFile,
	onCopyChapter,
}: ChapterSidePanelProps) {
	const { chapterLineCountsMap } = useChapterContext();
	const lineCounts = chapterLineCountsMap.get(chapter.id);

	const { width, panelRef, resizeHandleProps } = useResizablePanel({
		minWidth: CHAPTER_PANEL_MIN_WIDTH,
		maxWidth: resolveChapterPanelMaxWidth,
		defaultWidth: resolveChapterPanelDefaultWidth,
	});

	return (
		<div
			ref={panelRef}
			className="sticky top-[var(--content-top)] flex h-[calc(100vh_-_var(--content-top))] flex-col border-border border-r bg-card/30"
			style={{
				width,
				minWidth: CHAPTER_PANEL_MIN_WIDTH,
				maxWidth: `${CHAPTER_PANEL_MAX_WIDTH_FRACTION * 100}vw`,
			}}
		>
			<div className="shrink-0 border-border border-b">
				<ChapterNavigator
					chapter={chapter}
					chapterIndex={chapterIndex}
					viewedChapterIds={viewedChapterIds}
					onToggleViewed={onToggleChapterViewed}
					onCopyChapter={onCopyChapter}
				/>
				<Markdown
					content={chapter.title}
					inheritSize
					className="pb-1 pl-6 pr-4 font-semibold text-base leading-snug [&_.md-p]:my-0 lg:pl-8"
				/>
				{lineCounts && (lineCounts.linesAdded > 0 || lineCounts.linesDeleted > 0) ? (
					<LineCounts
						additions={lineCounts.linesAdded}
						deletions={lineCounts.linesDeleted}
						className="pb-3 pl-6 pr-4 lg:pl-8"
					/>
				) : (
					<div className="pb-2" />
				)}
			</div>
			<div className="flex-1 overflow-y-auto">
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
			</div>
			<div
				{...resizeHandleProps}
				className="absolute top-0 right-0 z-10 h-full w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50"
			/>
		</div>
	);
}
