import {
	type MergeStatusInfo,
	PULL_REQUEST_MERGE_METHOD,
	type PullRequestMergeMethod,
} from "@stagereview/types/pull-request";
import { useMutation } from "@tanstack/react-query";
import { Check, ChevronDown, GitMerge, Loader2 } from "lucide-react";
import { useState } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/sonner";
import { usePullRequestContext } from "@/lib/pull-request-context";
import {
	dequeueMutationOptions,
	enqueueMutationOptions,
	mergeMutationOptions,
	setAutoMergeMutationOptions,
	useInvalidatePullRequest,
} from "@/lib/pull-request-mutations";
import { cn } from "@/lib/utils";
import { getMergeAction, MERGE_ACTION } from "./merge-action";
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

function MergeStatusChip({ summary }: { summary: MergeStatusSummary }) {
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

export interface MergeStatusProps {
	mergeInfo: MergeStatusInfo;
	owner: string;
	repo: string;
	number: number;
	headSha: string;
	readOnly?: boolean;
}

export function MergeStatus({
	mergeInfo,
	owner,
	repo,
	number,
	headSha,
	readOnly = false,
}: MergeStatusProps) {
	const { runId } = usePullRequestContext();
	const invalidate = useInvalidatePullRequest(runId);
	const summary = getMergeStatusSummary(mergeInfo);
	const [chosenMethod, setChosenMethod] = useState<PullRequestMergeMethod | undefined>(
		() => mergeInfo.allowedMergeMethods[0],
	);
	// The component can stay mounted across navigation to a PR whose repo allows
	// different methods, so reconcile the picker selection against the current list
	// instead of trusting the once-initialized state (a stale method fails the merge).
	const mergeMethod =
		chosenMethod !== undefined && mergeInfo.allowedMergeMethods.includes(chosenMethod)
			? chosenMethod
			: mergeInfo.allowedMergeMethods[0];

	// onSettled returns the invalidation promise so the mutation stays "pending"
	// through the refetch — the button shows a spinner until the new state lands,
	// avoiding a flash of the old action between success and refetch.
	const errorMessage = (error: unknown, fallback: string) =>
		error instanceof Error ? error.message : fallback;

	const mergeMutation = useMutation({
		...mergeMutationOptions(runId),
		onSuccess: () => toast.success("Pull request merged"),
		onError: (error) => toast.error(errorMessage(error, "Failed to merge pull request")),
		onSettled: (_data, _error, _variables, ctx) => invalidate(ctx),
	});

	const enqueueMutation = useMutation({
		...enqueueMutationOptions(runId),
		onError: (error) => toast.error(errorMessage(error, "Failed to add to merge queue")),
		onSettled: (_data, _error, _variables, ctx) => invalidate(ctx),
	});

	const autoMergeMutation = useMutation({
		...setAutoMergeMutationOptions(runId),
		onError: (error) => toast.error(errorMessage(error, "Failed to update auto-merge")),
		onSettled: (_data, _error, _variables, ctx) => invalidate(ctx),
	});

	const dequeueMutation = useMutation({
		...dequeueMutationOptions(runId),
		onError: (error) => toast.error(errorMessage(error, "Failed to remove from merge queue")),
		onSettled: (_data, _error, _variables, ctx) => invalidate(ctx),
	});

	const isPending =
		mergeMutation.isPending ||
		enqueueMutation.isPending ||
		autoMergeMutation.isPending ||
		dequeueMutation.isPending;

	const action = getMergeAction(summary.status, mergeInfo, !readOnly);
	const isQueued = mergeInfo.isInMergeQueue && mergeInfo.entry !== null;

	// When queued, the PR-status pill shows "Queued", so don't repeat it here.
	// Otherwise the Merge button itself signals "ready"; in every other state the
	// chip carries something the button doesn't (the blocker).
	const showChip =
		!isQueued && !(summary.status === MERGE_STATUS.READY && action === MERGE_ACTION.MERGE);
	const showMethodPicker =
		!mergeInfo.isMergeQueueEnabled && mergeInfo.allowedMergeMethods.length > 1;

	function handleMerge() {
		if (mergeInfo.isMergeQueueEnabled) {
			enqueueMutation.mutate({ owner, repo, number, expectedHeadOid: headSha });
		} else if (mergeMethod !== undefined) {
			// getMergeAction only offers MERGE off-queue when a method is allowed.
			mergeMutation.mutate({ owner, repo, number, mergeMethod, expectedHeadOid: headSha });
		}
	}

	function handleEnableAutoMerge() {
		// The CLI's auto-merge maps to `gh pr merge --auto`; pin the reviewed head so the
		// stale-head guard (--match-head-commit) applies, as in handleMerge.
		autoMergeMutation.mutate({
			owner,
			repo,
			number,
			enabled: true,
			expectedHeadOid: headSha,
			...(mergeMethod !== undefined && { mergeMethod }),
		});
	}

	function handleRemoveFromQueue() {
		// The CLI's dequeue maps to the same `gh pr merge --disable-auto` as
		// disabling auto-merge, so one call both dequeues the queue entry and
		// clears any lingering auto-merge request.
		dequeueMutation.mutate({ owner, repo, number });
	}

	function handleDisableAutoMerge() {
		autoMergeMutation.mutate({ owner, repo, number, enabled: false });
	}

	const actionIcon = isPending ? (
		<Loader2 className="size-3.5 animate-spin" />
	) : (
		<GitMerge className="size-3.5" />
	);

	return (
		<div className="flex items-center gap-1.5">
			{showChip && <MergeStatusChip summary={summary} />}

			{action === MERGE_ACTION.MERGE && (
				<div className="flex items-center">
					<Button
						size="xs"
						disabled={isPending}
						onClick={handleMerge}
						className={cn(showMethodPicker && "rounded-r-none")}
					>
						{actionIcon}
						{mergeInfo.isMergeQueueEnabled || mergeMethod === undefined
							? "Merge"
							: MERGE_METHOD_LABELS[mergeMethod]}
					</Button>
					{showMethodPicker && (
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									size="xs"
									disabled={isPending}
									aria-label="Choose merge method"
									className="rounded-l-none border-l border-primary-foreground/20 px-1.5"
								>
									<ChevronDown className="size-3.5" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								{mergeInfo.allowedMergeMethods.map((method) => (
									<DropdownMenuItem key={method} onClick={() => setChosenMethod(method)}>
										<Check className={cn("size-3.5", mergeMethod !== method && "invisible")} />
										{MERGE_METHOD_LABELS[method]}
									</DropdownMenuItem>
								))}
							</DropdownMenuContent>
						</DropdownMenu>
					)}
				</div>
			)}

			{action === MERGE_ACTION.ENABLE_AUTO_MERGE && (
				<Button variant="outline" size="xs" disabled={isPending} onClick={handleEnableAutoMerge}>
					{actionIcon}
					Auto-merge
				</Button>
			)}

			{action === MERGE_ACTION.REMOVE_FROM_QUEUE && (
				// Keyed by run so stack navigation while the confirmation is open
				// remounts (and closes) it instead of retargeting the sibling PR.
				<AlertDialog key={runId}>
					<AlertDialogTrigger asChild>
						<Button variant="secondary" size="xs" disabled={isPending}>
							{actionIcon}
							Remove from queue
						</Button>
					</AlertDialogTrigger>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Remove from merge queue</AlertDialogTitle>
							<AlertDialogDescription>
								Removing this pull request from the queue could impact other pull requests in the
								queue. Are you sure?
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction
								className={buttonVariants({ variant: "destructive" })}
								onClick={handleRemoveFromQueue}
							>
								Remove from queue
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			)}

			{action === MERGE_ACTION.DISABLE_AUTO_MERGE && (
				<Button variant="secondary" size="xs" disabled={isPending} onClick={handleDisableAutoMerge}>
					{actionIcon}
					Disable auto-merge
				</Button>
			)}
		</div>
	);
}
