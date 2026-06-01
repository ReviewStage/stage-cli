import { type GitHubPullRequest, PULL_REQUEST_STATUS } from "@stagereview/types/pull-request";
import {
	ChevronDown,
	GitPullRequest,
	GitPullRequestClosed,
	GitPullRequestDraft,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { PullRequestStatusInfo } from "@/lib/utils/pull-request-status";

interface PullRequestStatusDropdownProps {
	pullRequest: GitHubPullRequest;
	statusInfo: PullRequestStatusInfo;
	onClose: () => void;
	onReopen: () => void;
	onConvertToDraft: () => void;
	onMarkReady: () => void;
	isDraftTogglePending: boolean;
	isClosePending: boolean;
	isReopenPending: boolean;
	inMergeQueue?: boolean;
}

export function PullRequestStatus({
	pullRequest,
	statusInfo,
	onClose,
	onReopen,
	onConvertToDraft,
	onMarkReady,
	isDraftTogglePending,
	isClosePending,
	isReopenPending,
	inMergeQueue,
}: PullRequestStatusDropdownProps) {
	const [open, setOpen] = useState(false);
	const hasPendingAction = useRef(false);

	const anyPending = isDraftTogglePending || isClosePending || isReopenPending;

	useEffect(() => {
		if (anyPending) {
			hasPendingAction.current = true;
		} else if (hasPendingAction.current) {
			hasPendingAction.current = false;
			setOpen(false);
		}
	}, [anyPending]);

	const StatusIcon = statusInfo.icon;
	const isMerged = !!pullRequest.merged_at;
	const isOpen = pullRequest.state === PULL_REQUEST_STATUS.OPEN;
	const isClosed = pullRequest.state === PULL_REQUEST_STATUS.CLOSED && !isMerged;

	const canToggleDraft = isOpen && !inMergeQueue;

	// Merged is a terminal state — static pill, no dropdown
	if (isMerged) {
		return (
			<div
				className={cn(
					"inline-flex items-center gap-1.5 rounded-md px-2.5 py-1",
					statusInfo.bgColor,
				)}
			>
				<StatusIcon className={cn("size-3.5", statusInfo.color)} />
				<span className={cn("font-medium text-sm", statusInfo.color)}>{statusInfo.label}</span>
			</div>
		);
	}

	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					className={cn(
						"inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 transition-colors hover:bg-muted/50",
						statusInfo.bgColor,
					)}
				>
					<StatusIcon className={cn("size-3.5", statusInfo.color)} />
					<span className={cn("font-medium text-sm", statusInfo.color)}>{statusInfo.label}</span>
					<ChevronDown
						className={cn(
							"size-3 text-muted-foreground transition-transform duration-200",
							open && "rotate-180",
						)}
					/>
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-56">
				{isOpen && (
					<>
						{canToggleDraft &&
							(pullRequest.draft ? (
								<DropdownMenuItem
									onSelect={(e) => {
										e.preventDefault();
										onMarkReady();
									}}
									disabled={isDraftTogglePending}
								>
									<GitPullRequest className="size-4 text-green-600" />
									{isDraftTogglePending ? "Marking ready…" : "Mark as ready"}
								</DropdownMenuItem>
							) : (
								<DropdownMenuItem
									onSelect={(e) => {
										e.preventDefault();
										onConvertToDraft();
									}}
									disabled={isDraftTogglePending}
								>
									<GitPullRequestDraft className="size-4 text-muted-foreground" />
									{isDraftTogglePending ? "Converting to draft…" : "Convert to draft"}
								</DropdownMenuItem>
							))}
						<DropdownMenuItem
							onSelect={(e) => {
								e.preventDefault();
								onClose();
							}}
							disabled={isClosePending}
						>
							<GitPullRequestClosed className="size-4 text-destructive" />
							Close pull request
						</DropdownMenuItem>
					</>
				)}
				{isClosed && (
					<DropdownMenuItem
						onSelect={(e) => {
							e.preventDefault();
							onReopen();
						}}
						disabled={isReopenPending}
					>
						{isReopenPending ? "Reopening…" : "Reopen pull request"}
					</DropdownMenuItem>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
