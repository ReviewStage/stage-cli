import {
	FILE_VIEWED_STATE,
	type FileViewedState,
	FileViewRow,
} from "@/components/chapter/file-view-row";
import type { FileDiffEntry } from "@/lib/parse-diff";

interface ChapterFileListProps {
	entries: FileDiffEntry[];
	viewedPathSet: ReadonlySet<string>;
	onToggleFileViewed: (filePath: string) => void;
	onSelectFile: (filePath: string) => void;
}

export function ChapterFileList({
	entries,
	viewedPathSet,
	onToggleFileViewed,
	onSelectFile,
}: ChapterFileListProps) {
	return (
		<div className="py-3 pl-6 pr-4 lg:pl-8">
			<h2 className="mb-2 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
				Files <span className="text-muted-foreground/60">({entries.length})</span>
			</h2>
			<div className="space-y-0.5">
				{entries.map(({ file }) => {
					const viewedState: FileViewedState = viewedPathSet.has(file.path)
						? FILE_VIEWED_STATE.VIEWED
						: FILE_VIEWED_STATE.UNVIEWED;
					return (
						<FileViewRow
							key={file.path}
							filePath={file.path}
							status={file.status}
							viewedState={viewedState}
							onToggleViewed={onToggleFileViewed}
							onSelect={onSelectFile}
						/>
					);
				})}
			</div>
		</div>
	);
}
