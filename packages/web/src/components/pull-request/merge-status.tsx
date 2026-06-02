import {
	type MergeStatusInfo,
	PULL_REQUEST_MERGE_METHOD,
	type PullRequestMergeMethod,
} from "@stagereview/types/pull-request";
import { useMutation } from "@tanstack/react-query";
import { Check, ChevronDown, GitMerge, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";
import { usePullRequestContext } from "@/lib/pull-request-context";
import {
	dequeueMutationOptions,
	enqueueMutationOptions,
	mergeMutationOptions,
	setAutoMergeMutationOptions,
	useInvalidatePullRequest,
} from "@/lib/pull-request-mutations";
import { cn } from "@/lib/utils";
import {
	getMergeStatusSummary,
	MERGE_STATUS,
	type MergeStatusSummary,
} from "./merge-status-summary";

const MERGE_METHOD_LABELS: Record<PullRequestMergeMethod, string> = {
	[PULL_REQUEST_MERGE_METHOD.SQUASH]: "Squash and merge",
	[PULL_REQUEST_MERGE_METHOD.MERGE]: "Merge pull request",
	[PULL_REQUEST_MERGE_METHOD.REBASE]: "Rebase and merge",
};

function MergeActions({
	mergeInfo,
	summary,
	owner,
	repo,
	number,
	headSha,
}: {
	mergeInfo: MergeStatusInfo;
	summary: MergeStatusSummary;
	owner: string;
	repo: string;
	number: number;
	headSha: string;
}) {
	const { runId } = usePullRequestContext();
	const invalidateAfterMutation = useInvalidatePullRequest(runId);
	const [mergeMethod, setMergeMethod] = useState<PullRequestMergeMethod>(
		() => mergeInfo.allowedMergeMethods[0] ?? PULL_REQUEST_MERGE_METHOD.MERGE,
	);

	const mergeMutation = useMutation({
		...mergeMutationOptions(runId),
		onSuccess: () => {
			toast.success("Pull request merged");
			invalidateAfterMutation();
		},
		onError: (error) => {
			toast.error(error instanceof Error ? error.message : "Failed to merge pull request");
		},
	});

	const enqueueMutation = useMutation({
		...enqueueMutationOptions(runId),
		onError: (error) => {
			toast.error(error instanceof Error ? error.message : "Failed to add to merge queue");
		},
		onSettled: invalidateAfterMutation,
	});

	const autoMergeMutation = useMutation({
		...setAutoMergeMutationOptions(runId),
		onError: (error) => {
			toast.error(error instanceof Error ? error.message : "Failed to update auto-merge");
		},
		onSettled: invalidateAfterMutation,
	});

	const dequeueMutation = useMutation({
		...dequeueMutationOptions(runId),
		onError: (error) => {
			toast.error(error instanceof Error ? error.message : "Failed to remove from merge queue");
		},
		onSettled: invalidateAfterMutation,
	});

	const anyPending =
		mergeMutation.isPending ||
		enqueueMutation.isPending ||
		autoMergeMutation.isPending ||
		dequeueMutation.isPending;

	const optimisticAutoMergeEnabled =
		autoMergeMutation.isPending && autoMergeMutation.variables
			? autoMergeMutation.variables.enabled
			: mergeInfo.autoMergeEnabled;
	const optimisticInMergeQueue = enqueueMutation.isPending
		? true
		: dequeueMutation.isPending
			? false
			: mergeInfo.isInMergeQueue;

	const isReady = summary.status === MERGE_STATUS.READY;

	if (isReady && !mergeInfo.isMergeQueueEnabled && mergeInfo.allowedMergeMethods.length > 0) {
		return (
			<div className="flex flex-col gap-2">
				<div className="flex items-center gap-1.5">
					<Button
						size="sm"
						className="flex-1"
						disabled={anyPending}
						onClick={() =>
							mergeMutation.mutate({ owner, repo, number, mergeMethod, expectedHeadOid: headSha })
						}
					>
						{mergeMutation.isPending ? (
							<Loader2 className="size-3.5 animate-spin" />
						) : (
							<GitMerge className="size-3.5" />
						)}
						{MERGE_METHOD_LABELS[mergeMethod]}
					</Button>
					{mergeInfo.allowedMergeMethods.length > 1 && (
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="outline" size="sm" className="px-1.5">
									<ChevronDown className="size-3.5" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								{mergeInfo.allowedMergeMethods.map((method) => (
									<DropdownMenuItem key={method} onClick={() => setMergeMethod(method)}>
										<Check className={cn("size-3.5", mergeMethod !== method && "invisible")} />
										{MERGE_METHOD_LABELS[method]}
									</DropdownMenuItem>
								))}
							</DropdownMenuContent>
						</DropdownMenu>
					)}
				</div>
			</div>
		);
	}

	if (mergeInfo.isMergeQueueEnabled) {
		const isMergeWhenReady = optimisticInMergeQueue || optimisticAutoMergeEnabled;
		return (
			<div className="flex items-center gap-2">
				<span
					className={cn(
						"text-sm",
						anyPending ? "cursor-not-allowed text-muted-foreground/50" : "text-muted-foreground",
					)}
				>
					{anyPending ? "Updating…" : "Merge when ready"}
				</span>
				<Switch
					checked={isMergeWhenReady}
					disabled={anyPending}
					onCheckedChange={(checked) => {
						if (checked) {
							if (isReady) {
								enqueueMutation.mutate({ owner, repo, number, expectedHeadOid: headSha });
							} else {
								autoMergeMutation.mutate({
									owner,
									repo,
									number,
									enabled: true,
									mergeMethod,
									expectedHeadOid: headSha,
								});
							}
						} else if (mergeInfo.isInMergeQueue && mergeInfo.entry) {
							dequeueMutation.mutate({
								owner,
								repo,
								number,
								mergeQueueEntryId: mergeInfo.entry.id,
							});
						} else if (mergeInfo.autoMergeEnabled) {
							// `else if`: both dequeue and disabling auto-merge map to the same
							// `gh pr merge --disable-auto` here, so fire only one to avoid a
							// duplicate request (and a spurious error toast on the second).
							autoMergeMutation.mutate({ owner, repo, number, enabled: false });
						}
					}}
				/>
			</div>
		);
	}

	if (mergeInfo.autoMergeAllowed || mergeInfo.viewerCanDisableAutoMerge) {
		return (
			<div className="flex items-center gap-2">
				<span
					className={cn(
						"text-sm",
						anyPending ? "cursor-not-allowed text-muted-foreground/50" : "text-muted-foreground",
					)}
				>
					{anyPending ? "Updating…" : "Merge when ready"}
				</span>
				<Switch
					checked={optimisticAutoMergeEnabled}
					disabled={anyPending}
					onCheckedChange={(checked) => {
						autoMergeMutation.mutate({
							owner,
							repo,
							number,
							enabled: checked,
							...(checked && { mergeMethod, expectedHeadOid: headSha }),
						});
					}}
				/>
			</div>
		);
	}

	return (
		<p className="text-muted-foreground text-sm">
			{summary.isTransient
				? "Waiting for status checks to complete."
				: "This pull request cannot be merged yet."}
		</p>
	);
}

export interface MergeStatusProps {
	mergeInfo: MergeStatusInfo;
	owner: string;
	repo: string;
	number: number;
	headSha: string;
}

export function MergeStatus({ mergeInfo, owner, repo, number, headSha }: MergeStatusProps) {
	const summary = getMergeStatusSummary(mergeInfo);
	const MergeIcon = summary.icon;

	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					type="button"
					className={cn(
						"inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-opacity hover:opacity-80",
						summary.pillBg,
					)}
				>
					<MergeIcon className={cn("size-3.5", summary.iconColor)} />
					<span className={cn("font-medium", summary.accentColor)}>{summary.label}</span>
					<ChevronDown className="size-3 text-muted-foreground" />
				</button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-auto">
				<MergeActions
					mergeInfo={mergeInfo}
					summary={summary}
					owner={owner}
					repo={repo}
					number={number}
					headSha={headSha}
				/>
			</PopoverContent>
		</Popover>
	);
}
