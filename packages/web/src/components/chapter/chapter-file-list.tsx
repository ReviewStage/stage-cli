import { useMemo, useState } from "react";
import { FileFilterInput } from "@/components/files/file-filter-input";
import { FileTree, type ViewedConfig } from "@/components/files/file-tree";
import { FILE_VIEWED_STATE, type PullRequestFile } from "@/lib/diff-types";

// The CLI has no review comments, so the tree never renders comment badges.
const NO_COMMENT_COUNTS: Map<string, number> = new Map();

interface ChapterFileListProps {
	files: PullRequestFile[];
	focusedFilePath?: string;
	viewedPathSet: ReadonlySet<string>;
	onToggleFileViewed: (filePath: string) => void;
	onSelectFile: (filePath: string) => void;
}

export function ChapterFileList({
	files,
	focusedFilePath,
	viewedPathSet,
	onToggleFileViewed,
	onSelectFile,
}: ChapterFileListProps) {
	const [filter, setFilter] = useState("");

	const viewed = useMemo<ViewedConfig>(
		() => ({
			stateByPath: new Map(
				files.map((file) => [
					file.path,
					viewedPathSet.has(file.path) ? FILE_VIEWED_STATE.VIEWED : FILE_VIEWED_STATE.UNVIEWED,
				]),
			),
			onToggle: onToggleFileViewed,
		}),
		[files, viewedPathSet, onToggleFileViewed],
	);

	return (
		<div className="py-3 pl-6 pr-4 lg:pl-8">
			<h2 className="mb-2 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
				Files <span className="text-muted-foreground/60">({files.length})</span>
			</h2>
			<FileFilterInput value={filter} onChange={setFilter} className="mb-2" />
			<FileTree
				files={files}
				focusedFilePath={focusedFilePath}
				onSelectFile={onSelectFile}
				viewed={viewed}
				commentCountsByPath={NO_COMMENT_COUNTS}
				filter={filter}
			/>
		</div>
	);
}
