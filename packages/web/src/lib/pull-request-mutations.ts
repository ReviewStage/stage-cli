import type { PullRequestMergeMethod } from "@stagereview/types/pull-request";
import { useQueryClient } from "@tanstack/react-query";

function prPath(runId: string, suffix: string): string {
	return `/api/runs/${encodeURIComponent(runId)}/pull-request${suffix}`;
}

async function write(
	runId: string,
	suffix: string,
	method: "POST" | "PATCH" | "DELETE",
	body: Record<string, unknown>,
): Promise<unknown> {
	const path = prPath(runId, suffix);
	const res = await fetch(path, {
		method,
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const text = await res.text();
	if (!res.ok) {
		// The server returns `{ error: <gh stderr> }` on failure — surface it so the
		// toast shows the actionable gh message, not a generic "POST … failed: 500".
		let message = `${method} ${path} failed: ${res.status}`;
		try {
			const parsed: unknown = text ? JSON.parse(text) : null;
			if (parsed && typeof parsed === "object" && "error" in parsed) {
				const { error } = parsed as { error: unknown };
				if (typeof error === "string" && error) message = error;
			}
		} catch {
			// non-JSON body — keep the generic message
		}
		throw new Error(message);
	}
	return text ? JSON.parse(text) : {};
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
// Forward the head SHA so the server can guard against a stale head (--match-head-commit).
export function enqueueMutationOptions(runId: string) {
	return {
		mutationFn: (v: RepoVars & { number: number; expectedHeadOid?: string }) =>
			write(runId, "/auto-merge", "POST", {
				number: v.number,
				enabled: true,
				expectedHeadOid: v.expectedHeadOid,
			}),
	};
}

export function setAutoMergeMutationOptions(runId: string) {
	return {
		mutationFn: (
			v: RepoVars & {
				number: number;
				enabled: boolean;
				mergeMethod?: PullRequestMergeMethod;
				// Forward the head SHA so enabling auto-merge guards against a stale head
				// (--match-head-commit). The server ignores it when disabling.
				expectedHeadOid?: string;
			},
		) =>
			write(runId, "/auto-merge", "POST", {
				number: v.number,
				enabled: v.enabled,
				mergeMethod: v.mergeMethod,
				expectedHeadOid: v.expectedHeadOid,
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
