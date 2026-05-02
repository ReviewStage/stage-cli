import { Circle, CircleCheck, MessageSquare } from "lucide-react";
import type { MouseEvent } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { FileStatus } from "@/lib/diff-types";
import { FILE_STATUS_ICONS, FILE_STATUS_TEXT_COLORS } from "@/lib/file-status";
import { cn } from "@/lib/utils";

export const FILE_VIEWED_STATE = {
	DISMISSED: "DISMISSED",
	UNVIEWED: "UNVIEWED",
	VIEWED: "VIEWED",
} as const;
export type FileViewedState = (typeof FILE_VIEWED_STATE)[keyof typeof FILE_VIEWED_STATE];

interface FileViewRowProps {
	filePath: string;
	// Optional in stage-cli: the chapters API returns hunkRefs (filePath + oldStart) but no
	// file-status metadata. The leading status icon is omitted when status is absent so we
	// don't render a misleading "modified" placeholder. The forthcoming /api/diff.patch
	// route will let callers pass the real status.
	status?: FileStatus;
	viewedState?: FileViewedState;
	commentCount?: number;
	onToggleViewed?: (filePath: string) => void;
	onSelect?: (filePath: string) => void;
}

export function FileViewRow({
	filePath,
	status,
	viewedState = FILE_VIEWED_STATE.UNVIEWED,
	commentCount = 0,
	onToggleViewed,
	onSelect,
}: FileViewRowProps) {
	const Icon = status ? FILE_STATUS_ICONS[status] : null;
	const iconColorClass = status ? FILE_STATUS_TEXT_COLORS[status] : "";
	const isViewed = viewedState === FILE_VIEWED_STATE.VIEWED;

	const handleToggleViewed = onToggleViewed
		? (e: MouseEvent) => {
				e.stopPropagation();
				onToggleViewed(filePath);
			}
		: undefined;

	const lastSlashIndex = filePath.lastIndexOf("/");
	const directory = lastSlashIndex === -1 ? null : filePath.slice(0, lastSlashIndex + 1);
	const displayFilename = lastSlashIndex === -1 ? filePath : filePath.slice(lastSlashIndex + 1);

	const commentBadge = commentCount > 0 && (
		<span className="ml-auto flex shrink-0 items-center gap-1 text-muted-foreground text-xs">
			<MessageSquare className="size-3" />
			{commentCount}
		</span>
	);

	const fileContent = (
		<span
			className={cn(
				"flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
				onSelect && "cursor-pointer transition-colors hover:bg-accent/50",
			)}
		>
			{Icon && <Icon className={cn("size-4 shrink-0", iconColorClass)} />}
			<span className="flex min-w-0 flex-1 items-baseline overflow-hidden font-mono text-foreground/80 text-xs">
				{directory && (
					<span className="min-w-0 shrink-[999] truncate text-muted-foreground">{directory}</span>
				)}
				<span className="min-w-0 shrink truncate">{displayFilename}</span>
			</span>
			{commentBadge}
		</span>
	);

	return (
		<div className="flex items-center gap-0.5">
			{handleToggleViewed && (
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							onClick={handleToggleViewed}
							className={cn(
								"flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-accent",
								isViewed
									? "text-green-600 hover:text-green-700 dark:text-green-500 dark:hover:text-green-400"
									: "text-muted-foreground hover:text-foreground",
							)}
							aria-label={isViewed ? "Mark file as unviewed" : "Mark file as viewed"}
						>
							{isViewed ? <CircleCheck className="size-3.5" /> : <Circle className="size-3.5" />}
						</button>
					</TooltipTrigger>
					<TooltipContent side="top">
						{isViewed ? "Mark as unviewed" : "Mark as viewed"}
					</TooltipContent>
				</Tooltip>
			)}
			{onSelect ? (
				<Tooltip>
					<TooltipTrigger asChild>
						<button type="button" className="min-w-0 flex-1" onClick={() => onSelect(filePath)}>
							{fileContent}
						</button>
					</TooltipTrigger>
					<TooltipContent side="top" className="max-w-xs">
						<p className="break-all text-xs">{filePath}</p>
					</TooltipContent>
				</Tooltip>
			) : (
				<div className="min-w-0 flex-1">{fileContent}</div>
			)}
		</div>
	);
}
