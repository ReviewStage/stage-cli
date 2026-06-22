import {
	type PullCommentsResult,
	PullCommentsResultSchema,
	type PushCommentsResult,
	PushCommentsResultSchema,
} from "@stagereview/types/comments";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { commentThreadsQueryKey } from "./use-comment-threads";

export type { PullCommentsResult, PushCommentsResult };

/**
 * POST a sync endpoint, surfacing the server's `{ error }` message verbatim on a
 * non-2xx response (guardrail failures and the missing-PR case all carry one).
 * The generic `jsonFetch` only reports the status code, which would hide the
 * actionable reason a sync was refused.
 */
async function syncFetch<T>(url: string): Promise<T> {
	const res = await fetch(url, { method: "POST" });
	const text = await res.text();
	const parsed: unknown = text ? JSON.parse(text) : {};
	if (!res.ok) {
		const message =
			typeof parsed === "object" && parsed !== null && "error" in parsed
				? String((parsed as { error: unknown }).error)
				: `Sync failed (${res.status})`;
		throw new Error(message);
	}
	return parsed as T;
}

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
			syncFetch(`/api/runs/${encodeURIComponent(runId)}/comment-sync/pull`).then((raw) =>
				PullCommentsResultSchema.parse(raw),
			),
		onSuccess: invalidate,
	});

	const pushMutation = useMutation({
		mutationFn: () =>
			syncFetch(`/api/runs/${encodeURIComponent(runId)}/comment-sync/push`).then((raw) =>
				PushCommentsResultSchema.parse(raw),
			),
		onSuccess: invalidate,
	});

	return {
		pull: pullMutation.mutateAsync,
		push: pushMutation.mutateAsync,
		isPulling: pullMutation.isPending,
		isPushing: pushMutation.isPending,
	};
}
