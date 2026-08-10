import type { PullRequestMergeMethod } from "@stagereview/types/pull-request";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { jsonFetch } from "@/lib/use-view-state";

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
export function invalidatePullRequestQueries(
	queryClient: QueryClient,
	runId: string,
): Promise<unknown> {
	return Promise.all([
		queryClient.invalidateQueries({ queryKey: ["pull-request", runId] }),
		queryClient.invalidateQueries({ queryKey: ["pull-request-reviews", runId] }),
		queryClient.invalidateQueries({ queryKey: ["pull-request-merge-status", runId] }),
		queryClient.invalidateQueries({ queryKey: ["pull-request-checks", runId] }),
		queryClient.invalidateQueries({ queryKey: ["pull-request-labels", runId] }),
	]);
}

export function useInvalidatePullRequest(runId: string): () => Promise<unknown> {
	const queryClient = useQueryClient();
	return () => invalidatePullRequestQueries(queryClient, runId);
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

// ─── Labels (vendored from hosted `pullRequests.labels.*`, #1071) ───────────────

// The label subset the UI renders. Hosted shares its REST-derived `GitHubLabel`
// via @stage/types; the CLI's wire shape is defined by the labels route.
const GitHubLabelSchema = z.object({
	id: z.number(),
	name: z.string(),
	color: z.string(),
	description: z.string().nullable().optional(),
});
export type GitHubLabel = z.infer<typeof GitHubLabelSchema>;

// The PR's current labels; `null` when GitHub was unreachable (display degrades).
const PullRequestLabelsResponseSchema = z.object({
	labels: z.array(GitHubLabelSchema).nullable(),
});
// Every repository label, for the add-label picker (hosted `labels.list`).
const RepositoryLabelsResponseSchema = z.object({ labels: z.array(GitHubLabelSchema) });

/** The labels currently applied to the PR. */
export function pullRequestLabelsQueryOptions(runId: string, number: number) {
	return {
		queryKey: ["pull-request-labels", runId, number] as const,
		queryFn: async () =>
			PullRequestLabelsResponseSchema.parse(
				await jsonFetch(prPath(runId, `/labels?number=${number}`)),
			).labels,
	};
}

/** Every label defined on the repository. */
export function repositoryLabelsQueryOptions(runId: string) {
	return {
		queryKey: ["repository-labels", runId] as const,
		queryFn: async () =>
			RepositoryLabelsResponseSchema.parse(await jsonFetch(prPath(runId, "/labels/repository")))
				.labels,
	};
}

export function addLabelsMutationOptions(runId: string) {
	return {
		mutationFn: (v: RepoVars & { number: number; labels: string[] }) =>
			write(runId, "/labels", "POST", { number: v.number, labels: v.labels }),
	};
}

export function removeLabelMutationOptions(runId: string) {
	return {
		mutationFn: (v: RepoVars & { number: number; label: string }) =>
			write(runId, "/labels", "DELETE", { number: v.number, label: v.label }),
	};
}
