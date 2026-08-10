import { useMemo, useState } from "react";
import { FileFilterInput } from "@/components/files/file-filter-input";
import { FileTree, type ViewedConfig } from "@/components/files/file-tree";
import { buildFileCommentCountsMap } from "@/lib/comment-counts";
import { FILE_VIEWED_STATE, type PullRequestFile } from "@/lib/diff-types";
import { useReviewContext } from "@/lib/review-context";

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
	const { threads } = useReviewContext();

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

	const commentCountsByPath = useMemo(
		() => buildFileCommentCountsMap(files, threads),
		[files, threads],
	);

	return (
		<div className="pl-[var(--panel-pl,2rem)] pr-[var(--panel-pr,1rem)] py-3">
			<h2 className="mb-2 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
				Files <span className="text-muted-foreground/60">({files.length})</span>
			</h2>
			<FileFilterInput value={filter} onChange={setFilter} className="mb-2" />
			<FileTree
				files={files}
				focusedFilePath={focusedFilePath}
				onSelectFile={onSelectFile}
				viewed={viewed}
				commentCountsByPath={commentCountsByPath}
				filter={filter}
			/>
		</div>
	);
}
