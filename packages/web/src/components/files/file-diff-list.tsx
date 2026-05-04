import { FileCode } from "lucide-react";
import { forwardRef, useCallback, useImperativeHandle, useState } from "react";
import { FileHeader } from "@/components/chapter/file-header";
import { PierreDiffViewer } from "@/components/chapter/pierre-diff-viewer";
import type { AnnotatedLineRef, LineRef } from "@/lib/diff-types";
import type { FileDiffEntry } from "@/lib/parse-diff";

export interface FileDiffListHandle {
	scrollToFile: (filePath: string) => void;
}

export interface CollapseState {
	collapsedFiles: ReadonlySet<string>;
	toggleFileCollapsed: (filePath: string) => void;
	collapseAllFiles: () => void;
	expandAllFiles: () => void;
}

/**
 * Chapter line-ref overlay configuration. Bundled together because each prop
 * is meaningless without the others — passing one without the rest produces a
 * non-functional overlay.
 */
export interface ChapterOverlayProps {
	allLineRefsByFile: Map<string, AnnotatedLineRef[]> | null;
	focusedLineRefsByFile: Map<string, LineRef[]> | null;
	focusedKeyChangeId: string | null;
	isKeyChangeChecked: (keyChangeId: string) => boolean;
	onMarkKeyChangeChecked: (keyChangeId: string) => void;
	onUnmarkKeyChangeChecked: (keyChangeId: string) => void;
	onFocusKeyChange: (keyChangeId: string | null, scrollTarget?: LineRef | null) => void;
}

interface FileDiffListProps {
	entries: FileDiffEntry[];
	emptyMessage: string;
	viewedPathSet?: ReadonlySet<string>;
	onToggleViewed?: (path: string) => void;
	collapseState: CollapseState;
	chapterOverlay?: ChapterOverlayProps;
}

const FILE_TOP_PADDING = 16;

export const FileDiffList = forwardRef<FileDiffListHandle, FileDiffListProps>(function FileDiffList(
	{ entries, emptyMessage, viewedPathSet, onToggleViewed, collapseState, chapterOverlay },
	ref,
) {
	useImperativeHandle(
		ref,
		() => ({
			scrollToFile(filePath: string) {
				const el = document.getElementById(`file-${filePath}`);
				if (!el) return;
				const stickyOffset = parseFloat(
					getComputedStyle(el).getPropertyValue("--content-top") || "0",
				);
				const top =
					el.getBoundingClientRect().top + window.scrollY - stickyOffset - FILE_TOP_PADDING;
				window.scrollTo({ top });
			},
		}),
		[],
	);

	if (entries.length === 0) {
		return (
			<div className="flex h-96 flex-col items-center justify-center rounded-xl border border-border bg-card/50">
				<FileCode className="mb-4 size-12 text-muted-foreground/30" aria-hidden="true" />
				<p className="mt-3 text-muted-foreground text-sm">{emptyMessage}</p>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{entries.map((entry) => (
				<FileDiffSection
					key={entry.file.path}
					entry={entry}
					isViewed={viewedPathSet?.has(entry.file.path) ?? false}
					onToggleViewed={onToggleViewed}
					collapseState={collapseState}
					chapterOverlay={chapterOverlay}
				/>
			))}
		</div>
	);
});

interface FileDiffSectionProps {
	entry: FileDiffEntry;
	isViewed: boolean;
	onToggleViewed?: (path: string) => void;
	collapseState: CollapseState;
	chapterOverlay?: ChapterOverlayProps;
}

function FileDiffSection({
	entry,
	isViewed,
	onToggleViewed,
	collapseState,
	chapterOverlay,
}: FileDiffSectionProps) {
	const { file, diff } = entry;
	const isCollapsed = collapseState.collapsedFiles.has(file.path);
	const [isExpanded, setIsExpanded] = useState(false);

	const handleToggle = useCallback(
		() => collapseState.toggleFileCollapsed(file.path),
		[collapseState, file.path],
	);
	const handleToggleAll = useCallback(
		() => (isCollapsed ? collapseState.expandAllFiles() : collapseState.collapseAllFiles()),
		[isCollapsed, collapseState],
	);
	const handleToggleExpand = useCallback(() => setIsExpanded((v) => !v), []);
	const handleToggleViewed = useCallback(() => {
		onToggleViewed?.(file.path);
	}, [onToggleViewed, file.path]);

	return (
		<div id={`file-${file.path}`}>
			<FileHeader
				file={file}
				isCollapsed={isCollapsed}
				isExpanded={isExpanded}
				isViewed={isViewed}
				onToggle={handleToggle}
				onToggleAll={handleToggleAll}
				onToggleExpand={handleToggleExpand}
				onToggleViewed={onToggleViewed ? handleToggleViewed : undefined}
			/>
			{!isCollapsed && (
				<PierreDiffViewer
					fileDiff={diff}
					filePath={file.path}
					expandUnchanged={isExpanded}
					allLineRefsByFile={chapterOverlay?.allLineRefsByFile}
					focusedLineRefsByFile={chapterOverlay?.focusedLineRefsByFile}
					focusedKeyChangeId={chapterOverlay?.focusedKeyChangeId ?? null}
					isKeyChangeChecked={chapterOverlay?.isKeyChangeChecked}
					onMarkKeyChangeChecked={chapterOverlay?.onMarkKeyChangeChecked}
					onUnmarkKeyChangeChecked={chapterOverlay?.onUnmarkKeyChangeChecked}
					onFocusKeyChange={chapterOverlay?.onFocusKeyChange}
				/>
			)}
		</div>
	);
}
