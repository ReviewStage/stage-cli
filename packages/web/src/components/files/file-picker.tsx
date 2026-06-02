import { FileText } from "lucide-react";
import { useMemo, useState } from "react";
import { CollapsiblePicker } from "@/components/files/collapsible-picker";
import { FileFilterInput } from "@/components/files/file-filter-input";
import { FileTree, type ViewedConfig } from "@/components/files/file-tree";
import type { PullRequestFile } from "@/lib/diff-types";
import { buildFileTree, flattenFileTree, sortFileTree } from "@/lib/file-tree";
import { SHORTCUT_KEY } from "@/lib/keyboard-shortcuts";
import { cn } from "@/lib/utils";

const FILE_PICKER_RESIZE = { minWidth: 280, defaultWidth: 280, maxWidth: 480 } as const;

interface FilePickerProps {
	files: PullRequestFile[];
	focusedFilePath?: string;
	viewed: ViewedConfig;
	commentCountsByPath: Map<string, number>;
	onSelectFile: (filePath: string) => void;
	className?: string;
}

export function FilePicker({
	files,
	focusedFilePath,
	viewed,
	commentCountsByPath,
	onSelectFile,
	className,
}: FilePickerProps) {
	const [filter, setFilter] = useState("");

	// The collapsed strip's indicators must follow the same tree order as the
	// expanded tree and the diff list, not the raw API order of `files`.
	const sortedFiles = useMemo(() => flattenFileTree(sortFileTree(buildFileTree(files))), [files]);

	return (
		<CollapsiblePicker
			icon={FileText}
			title="Files"
			count={files.length}
			shortcutKey={SHORTCUT_KEY.TOGGLE_FILES}
			className={className}
			resize={FILE_PICKER_RESIZE}
			headerExtra={<FileFilterInput value={filter} onChange={setFilter} />}
			collapsedIndicators={sortedFiles.map((file) => (
				<div
					key={file.path}
					className={cn(
						"h-0.5 w-5 rounded-full transition-colors",
						file.path === focusedFilePath ? "bg-primary" : "bg-muted-foreground/30",
					)}
				/>
			))}
		>
			<FileTree
				files={files}
				focusedFilePath={focusedFilePath}
				onSelectFile={onSelectFile}
				viewed={viewed}
				commentCountsByPath={commentCountsByPath}
				filter={filter}
			/>
		</CollapsiblePicker>
	);
}
