import { FileCode } from "lucide-react";
import { forwardRef, useCallback, useImperativeHandle, useState } from "react";
import { FileHeader } from "@/components/chapter/file-header";
import { PierreDiffViewer } from "@/components/chapter/pierre-diff-viewer";
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

interface FileDiffListProps {
	entries: FileDiffEntry[];
	emptyMessage: string;
	viewedPathSet?: ReadonlySet<string>;
	onToggleViewed?: (path: string) => void;
	collapseState: CollapseState;
}

const STICKY_HEADER_OFFSET = 64;

export const FileDiffList = forwardRef<FileDiffListHandle, FileDiffListProps>(function FileDiffList(
	{ entries, emptyMessage, viewedPathSet, onToggleViewed, collapseState },
	ref,
) {
	useImperativeHandle(
		ref,
		() => ({
			scrollToFile(filePath: string) {
				const el = document.getElementById(`file-${filePath}`);
				if (!el) return;
				const top = el.getBoundingClientRect().top + window.scrollY - STICKY_HEADER_OFFSET;
				window.scrollTo({ top, behavior: "smooth" });
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
}

const noop = () => {};

function FileDiffSection({ entry, isViewed, onToggleViewed, collapseState }: FileDiffSectionProps) {
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
				onComment={noop}
				onToggleViewed={onToggleViewed ? handleToggleViewed : undefined}
			/>
			{!isCollapsed && (
				<PierreDiffViewer fileDiff={diff} filePath={file.path} expandUnchanged={isExpanded} />
			)}
		</div>
	);
}
