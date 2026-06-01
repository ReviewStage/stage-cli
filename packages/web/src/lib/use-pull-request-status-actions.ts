import type { GitHubPullRequest } from "@stagereview/types/pull-request";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "@/components/ui/sonner";
import {
	closeMutationOptions,
	draftMutationOptions,
	reopenMutationOptions,
	useInvalidatePullRequest,
} from "@/lib/pull-request-mutations";

interface Options {
	runId: string;
	pullRequest: GitHubPullRequest;
}

export function usePullRequestStatusActions({ runId, pullRequest }: Options) {
	const invalidate = useInvalidatePullRequest(runId);
	const [showCloseDialog, setShowCloseDialog] = useState(false);

	const draftMutation = useMutation({
		...draftMutationOptions(runId),
		onSuccess: async () => {
			await invalidate();
			toast.success(pullRequest.draft ? "Marked as ready for review" : "Converted to draft");
		},
		onError: (error) =>
			toast.error(error instanceof Error ? error.message : "Failed to update draft status"),
	});

	const closeMutation = useMutation({
		...closeMutationOptions(runId),
		onSuccess: async () => {
			await invalidate();
			setShowCloseDialog(false);
			toast.success("Pull request closed");
		},
		onError: (error) => {
			setShowCloseDialog(false);
			toast.error(error instanceof Error ? error.message : "Failed to close pull request");
		},
	});

	const reopenMutation = useMutation({
		...reopenMutationOptions(runId),
		onSuccess: async () => {
			await invalidate();
			toast.success("Pull request reopened");
		},
		onError: (error) =>
			toast.error(error instanceof Error ? error.message : "Failed to reopen pull request"),
	});

	const toggleDraft = () => {
		draftMutation.mutate({ number: pullRequest.number, draft: !pullRequest.draft });
	};

	return {
		onClose: () => setShowCloseDialog(true),
		onReopen: () => reopenMutation.mutate({ number: pullRequest.number }),
		onConvertToDraft: toggleDraft,
		onMarkReady: toggleDraft,
		isDraftTogglePending: draftMutation.isPending,
		isClosePending: closeMutation.isPending,
		isReopenPending: reopenMutation.isPending,
		showCloseDialog,
		setShowCloseDialog,
		confirmClose: () => closeMutation.mutate({ number: pullRequest.number }),
	};
}
