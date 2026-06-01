import type { DeploymentLink } from "@stagereview/types/pull-request";
import {
	type GitHubPullRequest,
	MERGE_STATE_STATUS,
	MERGEABLE_STATE,
	type MergeStatusInfo,
	PULL_REQUEST_STATUS,
} from "@stagereview/types/pull-request";
import { GitBranch, Github, ScanSearch } from "lucide-react";
import { useCallback } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { CIChecks } from "@/components/pull-request/ci-checks";
import { getMergeStatusSummary } from "@/components/pull-request/merge-status-summary";
import { Reviewers } from "@/components/pull-request/reviewers";
import { DeploymentLinkList } from "@/components/shared/deployment-link-list";
import { ShortcutTooltip } from "@/components/shared/shortcut-tooltip";
import { getUserDisplay, UserName } from "@/components/shared/user-name";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatTimeAgo } from "@/lib/format";
import { KEYBOARD_SHORTCUTS } from "@/lib/keyboard-shortcuts";
import { usePullRequestContext } from "@/lib/pull-request-context";
import { usePullRequestChecks } from "@/lib/use-pull-request";
import { cn } from "@/lib/utils";
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

function MergeStatusPill({ mergeInfo }: { mergeInfo: MergeStatusInfo }) {
	const summary = getMergeStatusSummary(mergeInfo);
	const Icon = summary.icon;
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm",
				summary.pillBg,
			)}
		>
			<Icon className={cn("size-3.5", summary.iconColor)} />
			<span className={cn("font-medium", summary.accentColor)}>{summary.label}</span>
		</span>
	);
}

export interface PullRequestHeaderProps {
	pullRequest: GitHubPullRequest;
	mergeInfo?: MergeStatusInfo;
}

export function PullRequestHeader({ pullRequest, mergeInfo }: PullRequestHeaderProps) {
	const { runId } = usePullRequestContext();
	const status = getPullRequestStatusInfo(pullRequest);
	const StatusIcon = status.icon;
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

	const statusPill = (
		<div
			className={cn(
				"inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1",
				status.bgColor,
			)}
		>
			<StatusIcon className={cn("size-3.5", status.color)} />
			<span className={cn("font-medium text-sm", status.color)}>{status.label}</span>
		</div>
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
		<header className="space-y-3">
			{/* Row 1: Status + Title + External links */}
			<div className="space-y-2 @xl:space-y-0">
				<div className="flex items-center justify-between gap-4 @xl:hidden">
					{statusPill}
					{externalLinks}
				</div>
				<div className="flex min-w-0 items-center gap-2 @xl:gap-3">
					<div className="hidden @xl:block">{statusPill}</div>
					<h1 className="flex min-w-0 items-baseline font-semibold text-xl leading-snug tracking-tight @xl:text-2xl">
						<span className="truncate">{pullRequest.title}</span>
						<span className="ml-2 shrink-0 font-normal text-muted-foreground/40">
							#{pullRequest.number}
						</span>
					</h1>
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
						{hasMergeData && mergeInfo && <MergeStatusPill mergeInfo={mergeInfo} />}
						{hasChecks && <CIChecks state={checksData.state} items={checksData.items} />}
					</>
				)}
				<Reviewers />
			</div>
		</header>
	);
}
