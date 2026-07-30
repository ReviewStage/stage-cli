import {
	type GitHubThreadsResponse,
	GitHubThreadsResponseSchema,
	type SubmitReviewBody,
} from "@stagereview/types/github-threads";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { commentThreadsQueryKey } from "./use-comment-threads";
import { jsonFetch } from "./use-view-state";

const GITHUB_THREADS_ROOT = "github-threads";

export function gitHubThreadsQueryKey(runId: string): readonly unknown[] {
	return [GITHUB_THREADS_ROOT, runId];
}

async function fetchGitHubThreads(runId: string): Promise<GitHubThreadsResponse> {
	// Parse at the boundary so server-side schema drift surfaces as a query error
	// here, not as a render crash deeper in the diff.
	const raw = await jsonFetch<unknown>(`/api/runs/${encodeURIComponent(runId)}/github-threads`);
	return GitHubThreadsResponseSchema.parse(raw);
}

const jsonRequest = (method: string, body?: unknown): RequestInit => ({
	method,
	headers: { "Content-Type": "application/json" },
	body: body === undefined ? undefined : JSON.stringify(body),
});

export interface UseGitHubThreadsResult {
	available: boolean;
	threads: GitHubThreadsResponse["threads"];
	isLoading: boolean;
	/** Covers the github-threads fetch only — see the mutation functions below. */
	error: unknown;
	refresh: () => Promise<void>;
	// submitReview/replyToGitHubThread/setGitHubThreadResolved surface no error
	// state of their own: each rejects on failure, so callers must `try`/`catch`
	// (or handle the rejection) around the call to detect and surface it — e.g.
	// as a toast. This mirrors the standard TanStack `mutateAsync` pattern.
	submitReview: (input: SubmitReviewBody) => Promise<void>;
	replyToGitHubThread: (input: { commentId: string; body: string }) => Promise<void>;
	setGitHubThreadResolved: (input: { threadNodeId: string; resolved: boolean }) => Promise<void>;
}

/**
 * Live-fetched GitHub review threads for a PR run. Unlike the local threads
 * query (instant SQLite reads, refetched on every edit), this one shells out
 * to gh — so it stays fresh only on demand: submit, reply, resolve, or an
 * explicit refresh.
 */
export function useGitHubThreads(runId: string): UseGitHubThreadsResult {
	const queryClient = useQueryClient();
	const queryKey = useMemo(() => gitHubThreadsQueryKey(runId), [runId]);

	const { data, isLoading, error } = useQuery<GitHubThreadsResponse>({
		queryKey,
		queryFn: () => fetchGitHubThreads(runId),
		enabled: runId !== "",
		staleTime: Number.POSITIVE_INFINITY,
	});

	const invalidate = useCallback(
		() => queryClient.invalidateQueries({ queryKey }),
		[queryClient, queryKey],
	);

	const submitMutation = useMutation({
		mutationFn: async (input: SubmitReviewBody) => {
			await jsonFetch(`/api/runs/${encodeURIComponent(runId)}/review`, jsonRequest("POST", input));
		},
		onSuccess: async () => {
			// The server deletes the run's local pending threads on a successful
			// submit, so the local comment-threads cache must be invalidated too.
			await Promise.all([
				invalidate(),
				queryClient.invalidateQueries({
					queryKey: commentThreadsQueryKey(runId),
				}),
			]);
		},
	});

	const replyMutation = useMutation({
		mutationFn: async ({ commentId, body }: { commentId: string; body: string }) => {
			await jsonFetch(
				`/api/runs/${encodeURIComponent(runId)}/github-threads/${encodeURIComponent(commentId)}/replies`,
				jsonRequest("POST", { body }),
			);
		},
		onSuccess: invalidate,
	});

	const resolveMutation = useMutation({
		mutationFn: async ({ threadNodeId, resolved }: { threadNodeId: string; resolved: boolean }) => {
			await jsonFetch(
				`/api/runs/${encodeURIComponent(runId)}/github-threads/${encodeURIComponent(threadNodeId)}/resolve`,
				jsonRequest("PATCH", { resolved }),
			);
		},
		onSuccess: invalidate,
	});

	return useMemo(
		() => ({
			available: data?.available ?? false,
			threads: data?.threads ?? [],
			isLoading,
			error,
			refresh: invalidate,
			submitReview: submitMutation.mutateAsync,
			replyToGitHubThread: replyMutation.mutateAsync,
			setGitHubThreadResolved: resolveMutation.mutateAsync,
		}),
		[
			data,
			isLoading,
			error,
			invalidate,
			submitMutation.mutateAsync,
			replyMutation.mutateAsync,
			resolveMutation.mutateAsync,
		],
	);
}
