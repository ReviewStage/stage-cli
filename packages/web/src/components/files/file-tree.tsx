import { Circle, CircleCheck, Folder, FolderOpen, MessageSquare } from "lucide-react";
import { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import {
	FILE_STATUS,
	FILE_VIEWED_STATE,
	type FileViewedState,
	type PullRequestFile,
} from "@/lib/diff-types";
import { FILE_STATUS_ICONS, FILE_STATUS_TEXT_COLORS } from "@/lib/file-status";
import { buildFileTree, collapseEmptyFolders, type FileNode, sortFileTree } from "@/lib/file-tree";
import { cn } from "@/lib/utils";

/** Each file row shows an interactive viewed toggle reflecting its state. */
export interface ViewedConfig {
	stateByPath: Map<string, FileViewedState>;
	onToggle: (filePath: string) => void;
}

interface FileTreeProps {
	files: PullRequestFile[];
	/** The file currently in focus, if any — highlighted and scrolled into view. */
	focusedFilePath?: string;
	onSelectFile: (filePath: string) => void;
	viewed: ViewedConfig;
	/** File rows show a comment-count badge for any path with a positive count. */
	commentCountsByPath: Map<string, number>;
	/** Controlled filter string; nodes are matched against their full path. */
	filter: string;
}

export function FileTree({
	files,
	focusedFilePath,
	onSelectFile,
	viewed,
	commentCountsByPath,
	filter,
}: FileTreeProps) {
	const tree = useMemo(() => collapseEmptyFolders(sortFileTree(buildFileTree(files))), [files]);

	const filteredTree = useMemo(() => {
		if (!filter) return tree;

		const lowerFilter = filter.toLowerCase();
		function filterNode(node: FileNode): FileNode | null {
			const matchesSelf = node.path.toLowerCase().includes(lowerFilter);

			const filteredChildren = new Map<string, FileNode>();
			for (const [name, child] of node.children) {
				const filteredChild = filterNode(child);
				if (filteredChild) {
					filteredChildren.set(name, filteredChild);
				}
			}

			if (matchesSelf || filteredChildren.size > 0) {
				return { ...node, children: filteredChildren };
			}

			return null;
		}

		return filterNode(tree) || { ...tree, children: new Map() };
	}, [tree, filter]);

	const rootChildren = useMemo(() => Array.from(filteredTree.children.values()), [filteredTree]);

	if (rootChildren.length === 0) {
		return <p className="py-4 text-center text-muted-foreground text-xs">No files found</p>;
	}

	return (
		<div className="space-y-0.5">
			{rootChildren.map((node) => (
				<FileTreeItem
					key={node.path}
					node={node}
					depth={0}
					focusedFilePath={focusedFilePath}
					onSelectFile={onSelectFile}
					viewed={viewed}
					commentCountsByPath={commentCountsByPath}
					filter={filter}
				/>
			))}
		</div>
	);
}

interface FileTreeItemProps {
	node: FileNode;
	depth: number;
	focusedFilePath?: string;
	onSelectFile: (filePath: string) => void;
	viewed: ViewedConfig;
	commentCountsByPath: Map<string, number>;
	filter: string;
}

function FileTreeItem({
	node,
	depth,
	focusedFilePath,
	onSelectFile,
	viewed,
	commentCountsByPath,
	filter,
}: FileTreeItemProps) {
	const [isExpanded, setIsExpanded] = useState(true);
	const itemRef = useRef<HTMLButtonElement>(null);
	const isFocused = node.file?.path === focusedFilePath;

	useEffect(() => {
		if (isFocused && itemRef.current) {
			itemRef.current.scrollIntoView({ block: "nearest" });
		}
	}, [isFocused]);

	useEffect(() => {
		if (filter) {
			setIsExpanded(true);
			return;
		}

		if (focusedFilePath) {
			const hasActiveChild = (n: FileNode): boolean => {
				if (n.file?.path === focusedFilePath) return true;
				for (const child of n.children.values()) {
					if (hasActiveChild(child)) return true;
				}
				return false;
			};
			if (hasActiveChild(node)) {
				setIsExpanded(true);
			}
		}
	}, [focusedFilePath, node, filter]);

	const children = useMemo(() => Array.from(node.children.values()), [node.children]);

	if (node.type === "file" && node.file) {
		const file = node.file;
		const isModified = file.status === FILE_STATUS.MODIFIED;
		const StatusIcon = FILE_STATUS_ICONS[file.status];
		const isViewed = viewed.stateByPath.get(file.path) === FILE_VIEWED_STATE.VIEWED;
		const commentCount = commentCountsByPath.get(file.path);

		const handleToggleViewed = (e: MouseEvent<HTMLButtonElement>) => {
			e.stopPropagation();
			viewed.onToggle(file.path);
			// A mouse click leaves the toggle focused, so `group-focus-within` would keep
			// it visible after un-marking a file even once the pointer leaves the row. Blur
			// on pointer clicks (detail > 0); keyboard activation (detail 0) keeps focus.
			if (e.detail > 0) e.currentTarget.blur();
		};

		return (
			<div
				className={cn(
					// Fixed height (not padding-driven) so the hover-only viewed toggle, which is
					// taller than the row's text, can't grow the row when it appears.
					"group relative flex h-7 items-center gap-2 rounded-md px-2 transition-colors",
					isFocused
						? "bg-accent text-foreground"
						: "text-muted-foreground hover:bg-accent hover:text-foreground",
					isViewed && !isFocused && "opacity-60",
				)}
				style={{ marginLeft: depth * 12 }}
			>
				{/* Stretched select button covers the whole row (matching the file header pattern):
				    passive content stays beneath it so clicks anywhere select the file, while the
				    viewed toggle is lifted above it with `relative z-10`. */}
				<button
					ref={itemRef}
					type="button"
					onClick={() => onSelectFile(file.path)}
					aria-label={node.name}
					className="absolute inset-0 cursor-pointer rounded-md focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
				/>
				<StatusIcon
					className={cn(
						"size-3.5 shrink-0",
						isModified
							? isFocused
								? "text-foreground"
								: "text-muted-foreground"
							: FILE_STATUS_TEXT_COLORS[file.status],
					)}
					aria-hidden="true"
				/>
				<span
					className={cn(
						"min-w-0 flex-1 truncate font-medium text-xs transition-colors",
						isFocused ? "text-foreground" : "group-hover:text-foreground",
					)}
				>
					{node.name}
				</span>
				<span className="flex shrink-0 items-center gap-1 font-medium text-[10px] tabular-nums opacity-70">
					{file.additions > 0 && (
						<span className="text-green-600 dark:text-green-500">+{file.additions}</span>
					)}
					{file.deletions > 0 && (
						<span className="text-red-600 dark:text-red-500">-{file.deletions}</span>
					)}
				</span>
				{commentCount ? (
					<span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
						<MessageSquare className="size-3" />
						{commentCount}
					</span>
				) : null}
				<button
					type="button"
					onClick={handleToggleViewed}
					className={cn(
						// `relative z-10` lifts the toggle above the stretched select button so it
						// stays clickable; show it only when viewed or on row hover/focus.
						"relative z-10 size-5 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-accent",
						isViewed
							? "flex text-green-600 hover:text-green-700 dark:text-green-500 dark:hover:text-green-400"
							: "hidden text-muted-foreground hover:text-foreground group-focus-within:flex group-hover:flex",
					)}
					aria-label={isViewed ? "Mark file as unviewed" : "Mark file as viewed"}
				>
					{isViewed ? <CircleCheck className="size-3.5" /> : <Circle className="size-3.5" />}
				</button>
			</div>
		);
	}

	return (
		<div className="flex flex-col">
			<button
				type="button"
				onClick={() => setIsExpanded(!isExpanded)}
				className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				style={{ marginLeft: depth * 12 }}
			>
				{isExpanded ? (
					<FolderOpen className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
				) : (
					<Folder className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
				)}
				<span className="min-w-0 flex-1 truncate font-medium text-xs">{node.name}</span>
			</button>
			{isExpanded && (
				<div className="flex flex-col">
					{children.map((child) => (
						<FileTreeItem
							key={child.path}
							node={child}
							depth={depth + 1}
							focusedFilePath={focusedFilePath}
							onSelectFile={onSelectFile}
							viewed={viewed}
							commentCountsByPath={commentCountsByPath}
							filter={filter}
						/>
					))}
				</div>
			)}
		</div>
	);
}
