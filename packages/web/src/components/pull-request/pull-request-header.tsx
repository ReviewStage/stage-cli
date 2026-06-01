import {
	type DeploymentLink,
	type GitHubPullRequest,
	MERGE_STATE_STATUS,
	MERGEABLE_STATE,
	type MergeStatusInfo,
	PULL_REQUEST_STATUS,
} from "@stagereview/types/pull-request";
import { useMutation } from "@tanstack/react-query";
import { Check, GitBranch, Github, Pencil, ScanSearch, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { CIChecks } from "@/components/pull-request/ci-checks";
import { MergeStatus } from "@/components/pull-request/merge-status";
import { PullRequestStatus } from "@/components/pull-request/pull-request-status";
import { Reviewers } from "@/components/pull-request/reviewers";
import { DeploymentLinkList } from "@/components/shared/deployment-link-list";
import { ShortcutTooltip } from "@/components/shared/shortcut-tooltip";
import { getUserDisplay, UserName } from "@/components/shared/user-name";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatTimeAgo } from "@/lib/format";
import { KEYBOARD_SHORTCUTS } from "@/lib/keyboard-shortcuts";
import { usePullRequestContext } from "@/lib/pull-request-context";
import { titleMutationOptions, useInvalidatePullRequest } from "@/lib/pull-request-mutations";
import { usePullRequestChecks } from "@/lib/use-pull-request";
import { usePullRequestStatusActions } from "@/lib/use-pull-request-status-actions";
import { getPullRequestStatusInfo } from "@/lib/utils/pull-request-status";

function HeaderDeploymentPopover({ deploymentLinks }: { deploymentLinks: DeploymentLink[] }) {
	return (
		<Popover>
			<Tooltip>
				<TooltipTrigger asChild>
					<PopoverTrigger asChild>
						<Button
							variant="outline"
							size="icon"
							className="size-8"
							aria-label="Open preview deployments"
						>
							<ScanSearch className="size-4" aria-hidden="true" />
						</Button>
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent>Preview deployments</TooltipContent>
			</Tooltip>
			<PopoverContent className="w-auto min-w-48 max-w-64 p-1" align="end" collisionPadding={12}>
				<DeploymentLinkList deploymentLinks={deploymentLinks} />
			</PopoverContent>
		</Popover>
	);
}

export interface PullRequestHeaderProps {
	pullRequest: GitHubPullRequest;
	mergeInfo?: MergeStatusInfo;
}

export function PullRequestHeader({ pullRequest, mergeInfo }: PullRequestHeaderProps) {
	const { runId, owner, repo } = usePullRequestContext();
	const inMergeQueue = mergeInfo?.isInMergeQueue;
	const mergeQueuePosition = mergeInfo?.entry?.position;
	const status = getPullRequestStatusInfo(pullRequest, { inMergeQueue, mergeQueuePosition });
	const authorProfileUrl = pullRequest.user ? getUserDisplay(pullRequest.user).profileUrl : null;
	const isOpen =
		pullRequest.state === PULL_REQUEST_STATUS.OPEN && !pullRequest.merged_at && !pullRequest.draft;
	const isOpenOrDraft = pullRequest.state === PULL_REQUEST_STATUS.OPEN;
	const hasMergeData =
		isOpen &&
		mergeInfo !== undefined &&
		!(
			mergeInfo.mergeable === MERGEABLE_STATE.UNKNOWN &&
			mergeInfo.mergeStateStatus === MERGE_STATE_STATUS.UNKNOWN
		);

	const { data: checksData } = usePullRequestChecks(runId, pullRequest.head.sha, isOpenOrDraft);
	const deploymentLinks = checksData?.deploymentLinks ?? [];
	const hasChecks = checksData && checksData.items.length > 0;

	// --- Title editing ---
	const [isEditing, setIsEditing] = useState(false);
	const [editValue, setEditValue] = useState(pullRequest.title);
	const inputRef = useRef<HTMLInputElement>(null);
	const invalidate = useInvalidatePullRequest(runId);

	const updateMutation = useMutation({
		...titleMutationOptions(runId),
		onSuccess: async () => {
			await invalidate();
			setIsEditing(false);
			toast.success("Title updated");
		},
		onError: (error) => {
			setEditValue(pullRequest.title);
			setIsEditing(false);
			toast.error(error instanceof Error ? error.message : "Failed to update title");
		},
	});

	function startEditing() {
		setEditValue(pullRequest.title);
		setIsEditing(true);
		requestAnimationFrame(() => inputRef.current?.focus());
	}

	function cancelEditing() {
		setIsEditing(false);
		setEditValue(pullRequest.title);
	}

	function submitEdit() {
		const trimmed = editValue.trim();
		if (!trimmed) return;
		if (trimmed === pullRequest.title) {
			setIsEditing(false);
			return;
		}
		updateMutation.mutate({ number: pullRequest.number, title: trimmed });
	}

	const copyToClipboard = useCallback((text: string, label: string) => {
		navigator.clipboard.writeText(text).then(
			() => toast.success(`Copied ${label} to clipboard`),
			() => toast.error("Failed to copy to clipboard"),
		);
	}, []);

	const copyBranchName = useCallback(() => {
		copyToClipboard(pullRequest.head.ref, "branch name");
	}, [copyToClipboard, pullRequest.head.ref]);

	useHotkeys(KEYBOARD_SHORTCUTS.COPY_BRANCH_NAME.hotkey, copyBranchName);

	const statusActions = usePullRequestStatusActions({ runId, pullRequest });

	const statusDropdown = (
		<PullRequestStatus
			pullRequest={pullRequest}
			statusInfo={status}
			onClose={statusActions.onClose}
			onReopen={statusActions.onReopen}
			onConvertToDraft={statusActions.onConvertToDraft}
			onMarkReady={statusActions.onMarkReady}
			isDraftTogglePending={statusActions.isDraftTogglePending}
			isClosePending={statusActions.isClosePending}
			isReopenPending={statusActions.isReopenPending}
			inMergeQueue={inMergeQueue}
		/>
	);

	const externalLinks = (
		<div className="flex shrink-0 items-center gap-2">
			{deploymentLinks.length === 1 && deploymentLinks[0] && (
				<Tooltip>
					<TooltipTrigger asChild>
						<Button variant="outline" size="icon" className="size-8" asChild>
							<a
								href={deploymentLinks[0].url}
								target="_blank"
								rel="noopener noreferrer"
								aria-label="Open preview deployment"
							>
								<ScanSearch className="size-4" aria-hidden="true" />
							</a>
						</Button>
					</TooltipTrigger>
					<TooltipContent>Open preview deployment</TooltipContent>
				</Tooltip>
			)}
			{deploymentLinks.length > 1 && <HeaderDeploymentPopover deploymentLinks={deploymentLinks} />}
			<Tooltip>
				<TooltipTrigger asChild>
					<Button variant="outline" size="icon" className="size-8" asChild>
						<a
							href={pullRequest.html_url}
							target="_blank"
							rel="noopener noreferrer"
							aria-label="Open in GitHub"
						>
							<Github className="size-4" aria-hidden="true" />
						</a>
					</Button>
				</TooltipTrigger>
				<TooltipContent>Open in GitHub</TooltipContent>
			</Tooltip>
		</div>
	);

	return (
		<>
			<header className="space-y-3">
				{/* Row 1: Status + Title + External links */}
				<div className="space-y-2 @xl:space-y-0">
					<div className="flex items-center justify-between gap-4 @xl:hidden">
						{statusDropdown}
						{externalLinks}
					</div>
					<div className="group flex min-w-0 items-center gap-2 @xl:gap-3">
						<div className="hidden @xl:block">{statusDropdown}</div>
						{isEditing ? (
							<>
								<Input
									ref={inputRef}
									value={editValue}
									onChange={(e) => setEditValue(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter") submitEdit();
										if (e.key === "Escape") cancelEditing();
									}}
									disabled={updateMutation.isPending}
									className="min-w-0 flex-1 font-semibold text-xl @xl:text-2xl"
								/>
								<Button
									variant="ghost"
									size="icon"
									onClick={submitEdit}
									disabled={updateMutation.isPending || !editValue.trim()}
									className="shrink-0"
								>
									<Check className="size-4" />
								</Button>
								<Button
									variant="ghost"
									size="icon"
									onClick={cancelEditing}
									disabled={updateMutation.isPending}
									className="shrink-0"
								>
									<X className="size-4" />
								</Button>
							</>
						) : (
							<>
								<h1 className="flex min-w-0 items-baseline font-semibold text-xl leading-snug tracking-tight @xl:text-2xl">
									<span className="truncate">{pullRequest.title}</span>
									<span className="ml-2 shrink-0 font-normal text-muted-foreground/40">
										#{pullRequest.number}
									</span>
								</h1>
								<Button
									variant="ghost"
									size="icon"
									onClick={startEditing}
									className="size-8 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
								>
									<Pencil className="size-3.5" />
								</Button>
							</>
						)}
						<div className="hidden @xl:ml-auto @xl:block">{externalLinks}</div>
					</div>
				</div>

				{/* Row 2: Metadata */}
				<div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-muted-foreground text-sm">
					{pullRequest.user && authorProfileUrl && (
						<>
							<a
								href={authorProfileUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="shrink-0"
							>
								<Avatar className="size-5">
									<AvatarImage src={pullRequest.user.avatar_url} alt={pullRequest.user.login} />
									<AvatarFallback className="text-[10px]">
										{pullRequest.user.login[0]?.toUpperCase()}
									</AvatarFallback>
								</Avatar>
							</a>
							<span className="shrink-0">
								<UserName user={pullRequest.user} />
								{" opened "}
								{formatTimeAgo(pullRequest.created_at)}
							</span>
							<span className="mx-0.5 h-3 w-px shrink-0 bg-border" />
						</>
					)}
					<GitBranch className="size-3.5 shrink-0" aria-hidden="true" />
					<ShortcutTooltip shortcutKey="COPY_BRANCH_NAME" label="Copy branch name">
						<button
							type="button"
							onClick={() => copyToClipboard(pullRequest.head.ref, "branch name")}
							className="min-w-0 cursor-pointer truncate rounded px-1.5 py-0.5 font-mono text-xs transition-colors hover:bg-muted/80"
						>
							{pullRequest.head.ref}
						</button>
					</ShortcutTooltip>
					<span className="shrink-0">→</span>
					<Tooltip>
						<TooltipTrigger asChild>
							<button
								type="button"
								onClick={() => copyToClipboard(pullRequest.base.ref, "base branch name")}
								className="min-w-0 cursor-pointer truncate rounded px-1.5 py-0.5 font-mono text-xs transition-colors hover:bg-muted/80"
							>
								{pullRequest.base.ref}
							</button>
						</TooltipTrigger>
						<TooltipContent>Copy base branch name</TooltipContent>
					</Tooltip>
					{isOpenOrDraft && (
						<>
							<span className="mx-0.5 hidden h-3 w-px shrink-0 bg-border @xl:inline" />
							{hasMergeData && mergeInfo && (
								<MergeStatus
									mergeInfo={mergeInfo}
									owner={owner}
									repo={repo}
									number={pullRequest.number}
									headSha={pullRequest.head.sha}
								/>
							)}
							{hasChecks && <CIChecks state={checksData.state} items={checksData.items} />}
						</>
					)}
					<Reviewers />
				</div>
			</header>

			<AlertDialog
				open={statusActions.showCloseDialog}
				onOpenChange={(open) => {
					if (!statusActions.isClosePending) statusActions.setShowCloseDialog(open);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Close pull request</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to close this pull request? You can reopen it later.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={statusActions.isClosePending}>Cancel</AlertDialogCancel>
						<Button
							variant="destructive"
							onClick={statusActions.confirmClose}
							disabled={statusActions.isClosePending}
						>
							{statusActions.isClosePending ? "Closing…" : "Close pull request"}
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
