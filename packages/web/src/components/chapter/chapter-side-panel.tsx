import type { Chapter } from "@stage-cli/types/chapters";
import { useCallback, useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/ui/markdown";
import type { FileDiffEntry } from "@/lib/parse-diff";
import { ChapterFileList } from "./chapter-file-list";
import { ChapterNavigator } from "./chapter-navigator";
import { ChapterSummary } from "./chapter-summary";

const MIN_WIDTH = 280;
const DEFAULT_WIDTH_FRACTION = 0.3;
const MAX_WIDTH_FRACTION = 0.5;
const SSR_FALLBACK_WIDTH = Math.round(1440 * DEFAULT_WIDTH_FRACTION);

interface ChapterSidePanelProps {
	chapter: Chapter;
	chapterIndex: number;
	chapterEntries: FileDiffEntry[];
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
	chapterEntries,
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
	const [width, setWidth] = useState(SSR_FALLBACK_WIDTH);
	const cleanupRef = useRef<(() => void) | null>(null);

	useEffect(() => {
		const max = Math.round(window.innerWidth * MAX_WIDTH_FRACTION);
		const def = Math.round(window.innerWidth * DEFAULT_WIDTH_FRACTION);
		setWidth(Math.min(max, Math.max(MIN_WIDTH, def)));
	}, []);

	const handleDoubleClick = useCallback(() => {
		const max = Math.round(window.innerWidth * MAX_WIDTH_FRACTION);
		const def = Math.round(window.innerWidth * DEFAULT_WIDTH_FRACTION);
		setWidth(Math.min(max, Math.max(MIN_WIDTH, def)));
	}, []);

	const handleMouseDown = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			const startX = e.clientX;
			const startWidth = width;

			const onMove = (ev: MouseEvent) => {
				const max = Math.round(window.innerWidth * MAX_WIDTH_FRACTION);
				setWidth(Math.min(max, Math.max(MIN_WIDTH, startWidth + ev.clientX - startX)));
			};
			const onUp = () => {
				document.removeEventListener("mousemove", onMove);
				document.removeEventListener("mouseup", onUp);
				document.body.style.cursor = "";
				document.body.style.userSelect = "";
				cleanupRef.current = null;
			};

			document.addEventListener("mousemove", onMove);
			document.addEventListener("mouseup", onUp);
			document.body.style.cursor = "col-resize";
			document.body.style.userSelect = "none";
			cleanupRef.current = onUp;
		},
		[width],
	);

	useEffect(() => () => cleanupRef.current?.(), []);

	return (
		<div
			className="sticky top-[var(--content-top)] flex h-[calc(100vh_-_var(--content-top))] flex-col border-border border-r bg-card/30"
			style={{ width, minWidth: MIN_WIDTH, maxWidth: `${MAX_WIDTH_FRACTION * 100}vw` }}
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
					className="pb-3 pl-6 pr-4 font-semibold text-base leading-snug [&_.md-p]:my-0 lg:pl-8"
				/>
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
						entries={chapterEntries}
						viewedPathSet={viewedFilePathSet}
						onToggleFileViewed={onToggleFileViewed}
						onSelectFile={onSelectFile}
					/>
				</div>
			</div>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: resize handle is a drag target, not an interactive widget */}
			<div
				onDoubleClick={handleDoubleClick}
				onMouseDown={handleMouseDown}
				className="absolute top-0 right-0 z-10 h-full w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50"
			/>
		</div>
	);
}
