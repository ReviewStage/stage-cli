import type { PullRequestMergeMethod } from "@stagereview/types/pull-request";
import { useQueryClient } from "@tanstack/react-query";
import { jsonFetch } from "@/lib/use-view-state";

function prPath(runId: string, suffix: string): string {
	return `/api/runs/${encodeURIComponent(runId)}/pull-request${suffix}`;
}

function write(
	runId: string,
	suffix: string,
	method: "POST" | "PATCH" | "DELETE",
	body: Record<string, unknown>,
): Promise<unknown> {
	return jsonFetch(prPath(runId, suffix), {
		method,
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

/** Invalidate every PR-derived query for a run after a mutation. */
export function useInvalidatePullRequest(runId: string): () => Promise<unknown> {
	const queryClient = useQueryClient();
	return () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: ["pull-request", runId] }),
			queryClient.invalidateQueries({ queryKey: ["pull-request-reviews", runId] }),
			queryClient.invalidateQueries({ queryKey: ["pull-request-merge-status", runId] }),
			queryClient.invalidateQueries({ queryKey: ["pull-request-checks", runId] }),
		]);
}

// Mutation-option factories — mirror hosted's `orpc.pullRequests.X.mutationOptions()`
// so the vendored components keep their `useMutation({ ...factory, onSuccess })` shape.
// They accept the components' `{ owner, repo, number, ... }` call shape (owner/repo
// are ignored — the server resolves the repo from the run).

/** Vendored components call `.mutate({ owner, repo, ... })`; accept and ignore those. */
type RepoVars = { owner?: string; repo?: string };

export function titleMutationOptions(runId: string) {
	return {
		mutationFn: (v: { number: number; title: string }) =>
			write(runId, "/title", "PATCH", { number: v.number, title: v.title }),
	};
}

export function closeMutationOptions(runId: string) {
	return {
		mutationFn: (v: { number: number }) => write(runId, "/close", "POST", { number: v.number }),
	};
}

export function reopenMutationOptions(runId: string) {
	return {
		mutationFn: (v: { number: number }) => write(runId, "/reopen", "POST", { number: v.number }),
	};
}

export function draftMutationOptions(runId: string) {
	return {
		mutationFn: (v: { number: number; draft: boolean }) =>
			write(runId, "/draft", "POST", { number: v.number, draft: v.draft }),
	};
}

export function mergeMutationOptions(runId: string) {
	return {
		mutationFn: (
			v: RepoVars & {
				number: number;
				mergeMethod: PullRequestMergeMethod;
				expectedHeadOid?: string;
			},
		) =>
			write(runId, "/merge", "POST", {
				number: v.number,
				mergeMethod: v.mergeMethod,
				expectedHeadOid: v.expectedHeadOid,
			}),
	};
}

// Merge-queue enqueue maps to "enable auto-merge" — gh enqueues when ready.
export function enqueueMutationOptions(runId: string) {
	return {
		mutationFn: (v: RepoVars & { number: number; expectedHeadOid?: string }) =>
			write(runId, "/auto-merge", "POST", { number: v.number, enabled: true }),
	};
}

export function setAutoMergeMutationOptions(runId: string) {
	return {
		mutationFn: (
			v: RepoVars & { number: number; enabled: boolean; mergeMethod?: PullRequestMergeMethod },
		) =>
			write(runId, "/auto-merge", "POST", {
				number: v.number,
				enabled: v.enabled,
				mergeMethod: v.mergeMethod,
			}),
	};
}

// Dequeue maps to "disable auto-merge".
export function dequeueMutationOptions(runId: string) {
	return {
		mutationFn: (v: RepoVars & { number: number; mergeQueueEntryId: string }) =>
			write(runId, "/auto-merge", "POST", { number: v.number, enabled: false }),
	};
}

export function addReviewerMutationOptions(runId: string) {
	return {
		mutationFn: (v: RepoVars & { number: number; reviewers: string[] }) =>
			write(runId, "/reviewers", "POST", { number: v.number, reviewers: v.reviewers }),
	};
}

export function removeReviewerMutationOptions(runId: string) {
	return {
		mutationFn: (v: RepoVars & { number: number; reviewer: string }) =>
			write(runId, "/reviewers", "DELETE", { number: v.number, reviewers: [v.reviewer] }),
	};
}
