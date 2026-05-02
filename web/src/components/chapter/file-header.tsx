import {
	ChevronRight,
	Circle,
	CircleCheck,
	FoldVertical,
	MessageSquare,
	UnfoldVertical,
} from "lucide-react";
import type { MouseEvent } from "react";
import { useCallback } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FILE_STATUS, type PullRequestFile } from "@/lib/diff-types";
import { FILE_STATUS_ICONS, FILE_STATUS_LABELS, FILE_STATUS_TEXT_COLORS } from "@/lib/file-status";
import { useIsMac } from "@/lib/use-is-mac";
import { cn } from "@/lib/utils";

function CopyableFilename({
	path,
	label,
	onCopy,
}: {
	path: string;
	label: string;
	onCopy: (path: string, label: string) => void;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					onClick={(event) => {
						event.stopPropagation();
						onCopy(path, label);
					}}
					className="min-w-0 cursor-pointer truncate rounded px-1 py-0.5 transition-colors hover:bg-black/10 dark:hover:bg-white/10"
					aria-label={`Copy ${label}`}
				>
					{path}
				</button>
			</TooltipTrigger>
			<TooltipContent side="top">Copy {label}</TooltipContent>
		</Tooltip>
	);
}

interface FileHeaderProps {
	file: PullRequestFile;
	isCollapsed: boolean;
	isExpanded: boolean;
	isViewed: boolean;
	onToggle: () => void;
	onToggleAll: () => void;
	onToggleExpand: () => void;
	onComment: () => void;
	onToggleViewed?: () => void;
	onCopyPath?: (path: string, label: string) => void;
}

export function FileHeader({
	file,
	isCollapsed,
	isExpanded,
	isViewed,
	onToggle,
	onToggleAll,
	onToggleExpand,
	onComment,
	onToggleViewed,
	onCopyPath,
}: FileHeaderProps) {
	const isMac = useIsMac();
	const altLabel = isMac ? "⌥" : "Alt";

	const copyPath = useCallback(
		(path: string, label: string) => {
			if (onCopyPath) {
				onCopyPath(path, label);
				return;
			}
			void navigator.clipboard.writeText(path);
		},
		[onCopyPath],
	);

	const handleCommentClick = (e: MouseEvent) => {
		e.stopPropagation();
		onComment();
	};

	const handleToggleClick = (e: MouseEvent<HTMLElement>) => {
		e.stopPropagation();
		if (e.altKey) {
			onToggleAll();
			return;
		}
		onToggle();
	};

	const handleExpandClick = (e: MouseEvent) => {
		e.stopPropagation();
		onToggleExpand();
	};

	const { oldPath } = file;

	const hasHiddenSections =
		file.status !== FILE_STATUS.ADDED &&
		file.status !== FILE_STATUS.DELETED &&
		file.status !== FILE_STATUS.MOVED;

	return (
		<div
			className={cn(
				"group/file-header sticky top-[var(--content-top)] z-10 flex w-full items-center gap-2 border border-border bg-muted px-3 py-2 text-left transition-colors",
				isCollapsed ? "rounded-lg" : "rounded-t-lg",
			)}
		>
			<button
				type="button"
				onClick={handleToggleClick}
				aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${file.path}`}
				aria-expanded={!isCollapsed}
				className={cn(
					"absolute inset-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
					isCollapsed ? "rounded-lg" : "rounded-t-lg",
				)}
			/>
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type="button"
						tabIndex={-1}
						onClick={handleToggleClick}
						className="-ml-1 relative z-10 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						aria-label={isCollapsed ? "Expand file" : "Collapse file"}
					>
						<ChevronRight
							className={cn(
								"size-4 transition-transform duration-200",
								!isCollapsed && "rotate-90",
							)}
						/>
					</button>
				</TooltipTrigger>
				<TooltipContent side="top" className="text-center">
					<p>{isCollapsed ? "Expand file" : "Collapse file"}</p>
					<p className="text-muted-foreground">
						{altLabel}-click to {isCollapsed ? "expand" : "collapse"} all files
					</p>
				</TooltipContent>
			</Tooltip>
			{file.status !== FILE_STATUS.MODIFIED &&
				(() => {
					const StatusIcon = FILE_STATUS_ICONS[file.status];
					return (
						<Tooltip>
							<TooltipTrigger asChild>
								<button
									type="button"
									onClick={(event) => event.stopPropagation()}
									className="relative z-10 inline-flex cursor-default"
									aria-label={FILE_STATUS_LABELS[file.status]}
								>
									<StatusIcon
										className={cn("size-4 shrink-0", FILE_STATUS_TEXT_COLORS[file.status])}
										aria-hidden="true"
									/>
								</button>
							</TooltipTrigger>
							<TooltipContent side="top">{FILE_STATUS_LABELS[file.status]}</TooltipContent>
						</Tooltip>
					);
				})()}
			<span className="relative z-10 flex min-w-0 items-center font-mono text-foreground text-xs">
				{oldPath ? (
					<>
						<CopyableFilename path={oldPath} label="old filename" onCopy={copyPath} />
						<span className="shrink-0 text-muted-foreground">→</span>
						<CopyableFilename path={file.path} label="new filename" onCopy={copyPath} />
					</>
				) : (
					<CopyableFilename path={file.path} label="filename" onCopy={copyPath} />
				)}
			</span>
			{hasHiddenSections && (
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							onClick={handleExpandClick}
							className="relative z-10 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/file-header:opacity-100 data-[state=delayed-open]:opacity-100 data-[state=instant-open]:opacity-100"
							aria-label={isExpanded ? "Collapse to changes" : "Expand full file"}
						>
							{isExpanded ? (
								<FoldVertical className="size-3.5" aria-hidden="true" />
							) : (
								<UnfoldVertical className="size-3.5" aria-hidden="true" />
							)}
						</button>
					</TooltipTrigger>
					<TooltipContent side="top">
						{isExpanded ? "Collapse to changes" : "Expand full file"}
					</TooltipContent>
				</Tooltip>
			)}
			<div className="flex-1" />
			<div className="relative z-10 flex shrink-0 items-center gap-1 font-medium text-[10px] tabular-nums">
				{file.additions > 0 && (
					<span className="text-green-600 dark:text-green-500">+{file.additions}</span>
				)}
				{file.deletions > 0 && (
					<span className="text-red-600 dark:text-red-500">-{file.deletions}</span>
				)}
			</div>
			{onToggleViewed && (
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								onToggleViewed();
							}}
							className={cn(
								"relative z-10 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-accent",
								isViewed
									? "text-green-600 hover:text-green-700 dark:text-green-500 dark:hover:text-green-400"
									: "text-muted-foreground hover:text-foreground",
							)}
							aria-label={isViewed ? "Mark file as unviewed" : "Mark file as viewed"}
						>
							{isViewed ? <CircleCheck className="size-3.5" /> : <Circle className="size-3.5" />}
						</button>
					</TooltipTrigger>
					<TooltipContent>{isViewed ? "Mark as unviewed" : "Mark as viewed"}</TooltipContent>
				</Tooltip>
			)}
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type="button"
						onClick={handleCommentClick}
						className="relative z-10 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
					>
						<MessageSquare className="size-3.5" aria-hidden="true" />
					</button>
				</TooltipTrigger>
				<TooltipContent>Comment on this file</TooltipContent>
			</Tooltip>
		</div>
	);
}
