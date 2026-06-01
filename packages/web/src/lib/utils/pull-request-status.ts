import { type GitHubPullRequest, PULL_REQUEST_STATUS } from "@stagereview/types/pull-request";
import { CircleDashed, GitMerge, GitPullRequest, type LucideIcon, XCircle } from "lucide-react";

export interface PullRequestStatusInfo {
	icon: LucideIcon;
	label: string;
	color: string;
	bgColor: string;
}

interface PullRequestStatusOptions {
	inMergeQueue?: boolean;
	mergeQueuePosition?: number;
}

export function getPullRequestStatusInfo(
	pullRequest: GitHubPullRequest,
	options?: PullRequestStatusOptions,
): PullRequestStatusInfo {
	if (pullRequest.merged_at) {
		return {
			icon: GitMerge,
			label: "Merged",
			color: "text-purple-500",
			bgColor: "bg-purple-500/10",
		};
	}
	if (pullRequest.state === PULL_REQUEST_STATUS.CLOSED) {
		return {
			icon: XCircle,
			label: "Closed",
			color: "text-destructive",
			bgColor: "bg-destructive/10",
		};
	}
	if (pullRequest.draft) {
		return {
			icon: CircleDashed,
			label: "Draft",
			color: "text-muted-foreground",
			bgColor: "bg-muted",
		};
	}
	if (options?.inMergeQueue) {
		return {
			icon: GitMerge,
			label: "Queued",
			color: "text-yellow-600",
			bgColor: "bg-yellow-500/10",
		};
	}
	return {
		icon: GitPullRequest,
		label: "Open",
		color: "text-primary",
		bgColor: "bg-primary/10",
	};
}
