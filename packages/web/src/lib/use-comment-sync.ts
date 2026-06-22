import {
	type PullCommentsResult,
	PullCommentsResultSchema,
	type PushCommentsResult,
	PushCommentsResultSchema,
} from "@stagereview/types/comments";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { commentThreadsQueryKey } from "./use-comment-threads";
import { jsonFetch } from "./use-view-state";

export type { PullCommentsResult, PushCommentsResult };

export interface UseCommentSyncResult {
	pull: () => Promise<PullCommentsResult>;
	push: () => Promise<PushCommentsResult>;
	isPulling: boolean;
	isPushing: boolean;
}

/**
 * Pull/push mutations that sync the run's comments with its GitHub PR. Both
 * invalidate the comment-threads query on success so freshly imported or
 * id-stamped comments render without a manual refresh.
 */
export function useCommentSync(runId: string): UseCommentSyncResult {
	const queryClient = useQueryClient();
	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: commentThreadsQueryKey(runId) });

	const pullMutation = useMutation({
		mutationFn: () =>
			jsonFetch<unknown>(`/api/runs/${encodeURIComponent(runId)}/comment-sync/pull`, {
				method: "POST",
			}).then((raw) => PullCommentsResultSchema.parse(raw)),
		onSuccess: invalidate,
	});

	const pushMutation = useMutation({
		mutationFn: () =>
			jsonFetch<unknown>(`/api/runs/${encodeURIComponent(runId)}/comment-sync/push`, {
				method: "POST",
			}).then((raw) => PushCommentsResultSchema.parse(raw)),
		onSuccess: invalidate,
	});

	return {
		pull: pullMutation.mutateAsync,
		push: pushMutation.mutateAsync,
		isPulling: pullMutation.isPending,
		isPushing: pushMutation.isPending,
	};
}
