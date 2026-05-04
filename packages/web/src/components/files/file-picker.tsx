import { ChevronRight, CircleCheck, FileText, Folder, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LineCounts } from "@/components/shared/line-counts";
import { FILE_STATUS, type PullRequestFile } from "@/lib/diff-types";
import { FILE_STATUS_ICONS, FILE_STATUS_TEXT_COLORS } from "@/lib/file-status";
import { buildFileTree, collapseEmptyFolders, type FileNode, sortFileTree } from "@/lib/file-tree";
import { cn } from "@/lib/utils";
import { CollapsiblePicker } from "./collapsible-picker";

interface FilePickerProps {
	files: PullRequestFile[];
	activeFilePath?: string;
	viewedPathSet?: ReadonlySet<string>;
	onSelectFile?: (filePath: string) => void;
	className?: string;
	isCollapsed: boolean;
	onCollapsedChange: (collapsed: boolean) => void;
}

export function FilePicker({
	files,
	activeFilePath,
	viewedPathSet,
	onSelectFile,
	className,
	isCollapsed,
	onCollapsedChange,
}: FilePickerProps) {
	const [filter, setFilter] = useState("");

	const tree = useMemo(() => collapseEmptyFolders(sortFileTree(buildFileTree(files))), [files]);

	const filteredTree = useMemo(() => {
		if (!filter) return tree;
		const lower = filter.toLowerCase();
		function filterNode(node: FileNode): FileNode | null {
			const matchesSelf = node.path.toLowerCase().includes(lower);
			const filteredChildren = new Map<string, FileNode>();
			for (const [name, child] of node.children) {
				const filteredChild = filterNode(child);
				if (filteredChild) filteredChildren.set(name, filteredChild);
			}
			if (matchesSelf || filteredChildren.size > 0) {
				return { ...node, children: filteredChildren };
			}
			return null;
		}
		return filterNode(tree) ?? { ...tree, children: new Map() };
	}, [tree, filter]);

	const rootChildren = useMemo(() => Array.from(filteredTree.children.values()), [filteredTree]);

	const filterInput = (
		<div className="relative">
			<Search
				className="-translate-y-1/2 absolute top-1/2 left-2.5 size-3.5 text-muted-foreground/50"
				aria-hidden="true"
			/>
			<input
				type="text"
				placeholder="Filter files..."
				value={filter}
				onChange={(e) => setFilter(e.target.value)}
				className="w-full rounded-md border border-border bg-background/50 py-1.5 pr-2 pl-8 text-xs outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
			/>
		</div>
	);

	return (
		<CollapsiblePicker
			icon={FileText}
			title="Files"
			count={files.length}
			className={className}
			headerExtra={filterInput}
			isCollapsed={isCollapsed}
			onCollapsedChange={onCollapsedChange}
			collapsedIndicators={files.map((file) => (
				<div
					key={file.path}
					className={cn(
						"h-0.5 w-5 rounded-full transition-colors",
						file.path === activeFilePath ? "bg-green-500" : "bg-muted-foreground/30",
					)}
				/>
			))}
		>
			{rootChildren.length > 0 ? (
				<div className="space-y-0.5">
					{rootChildren.map((node) => (
						<FilePickerTreeItem
							key={node.path}
							node={node}
							depth={0}
							activeFilePath={activeFilePath}
							viewedPathSet={viewedPathSet}
							onSelectFile={onSelectFile}
							filter={filter}
						/>
					))}
				</div>
			) : (
				<p className="py-4 text-center text-muted-foreground text-xs">No files found</p>
			)}
		</CollapsiblePicker>
	);
}

interface FilePickerTreeItemProps {
	node: FileNode;
	depth: number;
	activeFilePath?: string;
	viewedPathSet?: ReadonlySet<string>;
	onSelectFile?: (filePath: string) => void;
	filter: string;
}

function FilePickerTreeItem({
	node,
	depth,
	activeFilePath,
	viewedPathSet,
	onSelectFile,
	filter,
}: FilePickerTreeItemProps) {
	const [isExpanded, setIsExpanded] = useState(true);
	const itemRef = useRef<HTMLButtonElement>(null);
	const isActive = node.file?.path === activeFilePath;

	useEffect(() => {
		if (isActive && itemRef.current) {
			itemRef.current.scrollIntoView({ block: "nearest" });
		}
	}, [isActive]);

	useEffect(() => {
		if (filter) {
			setIsExpanded(true);
			return;
		}
		if (activeFilePath && hasActiveDescendant(node, activeFilePath)) {
			setIsExpanded(true);
		}
	}, [activeFilePath, node, filter]);

	const children = useMemo(() => Array.from(node.children.values()), [node.children]);

	if (node.type === "file" && node.file) {
		const file = node.file;
		const isModified = file.status === FILE_STATUS.MODIFIED;
		const StatusIcon = FILE_STATUS_ICONS[file.status];
		const isViewed = viewedPathSet?.has(file.path) ?? false;
		return (
			<button
				ref={itemRef}
				type="button"
				onClick={() => onSelectFile?.(file.path)}
				className={cn(
					"group flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left",
					isActive
						? "bg-primary/10 text-primary shadow-sm ring-1 ring-primary/20"
						: "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
					isViewed && !isActive && "opacity-60",
				)}
				style={{ paddingLeft: `${depth * 12 + 8}px` }}
			>
				<StatusIcon
					className={cn(
						"size-3.5 shrink-0",
						isModified
							? isActive
								? "text-primary"
								: "text-muted-foreground"
							: FILE_STATUS_TEXT_COLORS[file.status],
					)}
					aria-hidden="true"
				/>
				<span
					className={cn(
						"flex-1 truncate font-medium text-xs transition-colors",
						isActive ? "text-foreground" : "group-hover:text-foreground",
					)}
				>
					{node.name}
				</span>
				<LineCounts additions={file.additions} deletions={file.deletions} className="opacity-70" />
				{isViewed && (
					<CircleCheck
						className="size-3 shrink-0 text-green-600 dark:text-green-500"
						aria-hidden="true"
					/>
				)}
			</button>
		);
	}

	return (
		<div className="flex flex-col">
			<button
				type="button"
				onClick={() => setIsExpanded((v) => !v)}
				className="group flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-muted-foreground transition-all duration-200 hover:bg-accent/50 hover:text-foreground"
				style={{ paddingLeft: `${depth * 12 + 8}px` }}
			>
				<ChevronRight
					className={cn(
						"size-3.5 shrink-0 transition-transform duration-200",
						isExpanded && "rotate-90",
					)}
					aria-hidden="true"
				/>
				<Folder className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
				<span className="flex-1 truncate font-medium text-xs">{node.name}</span>
			</button>
			{isExpanded && (
				<div className="flex flex-col">
					{children.map((child) => (
						<FilePickerTreeItem
							key={child.path}
							node={child}
							depth={depth + 1}
							activeFilePath={activeFilePath}
							viewedPathSet={viewedPathSet}
							onSelectFile={onSelectFile}
							filter={filter}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function hasActiveDescendant(node: FileNode, activeFilePath: string): boolean {
	if (node.file?.path === activeFilePath) return true;
	for (const child of node.children.values()) {
		if (hasActiveDescendant(child, activeFilePath)) return true;
	}
	return false;
}
