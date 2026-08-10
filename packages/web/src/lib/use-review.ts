import type { CreateCommentThreadBody } from "@stagereview/types/comments";
import {
	GITHUB_REVIEW_STATUS,
	type GitHubCommentCreateBody,
	type GitHubReplyBody,
	type GitHubReviewStatus,
	type PendingReviewComment,
	type ReviewResponse,
	ReviewResponseSchema,
	type ReviewThread,
	type SubmitReviewBody,
} from "@stagereview/types/review";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { invalidatePullRequestQueries } from "./pull-request-mutations";
import { jsonFetch } from "./use-view-state";

export type { ReviewThread };
export { GITHUB_REVIEW_STATUS };

const REVIEW_ROOT = "review";

interface ReviewMutationOrigin {
	runId: string;
	queryKey: readonly unknown[];
}

export function reviewQueryKey(runId: string): readonly unknown[] {
	return [REVIEW_ROOT, runId];
}

async function fetchReview(runId: string): Promise<ReviewResponse> {
	const raw = await jsonFetch<unknown>(`/api/runs/${encodeURIComponent(runId)}/review`);
	return ReviewResponseSchema.parse(raw);
}

const jsonRequest = (method: string, body?: unknown): RequestInit => ({
	method,
	headers: { "Content-Type": "application/json" },
	body: body === undefined ? undefined : JSON.stringify(body),
});

export interface UseReviewResult {
	threads: ReviewThread[];
	threadsByFile: ReadonlyMap<string, ReviewThread[]>;
	github: GitHubReviewStatus;
	pendingComments: PendingReviewComment[];
	hasPendingReview: boolean;
	pendingReviewBody: string;
	isOwnPullRequest: boolean;
	canWriteToGitHub: boolean;
	error: unknown;
	// Local comments (CLI-only, work offline).
	createLocalThread: (input: CreateCommentThreadBody) => Promise<unknown>;
	// Create a comment directly on the PR, either pending or immediately published.
	createGitHubComment: (input: GitHubCommentCreateBody) => Promise<void>;
	replyLocal: (input: { threadId: string; body: string }) => Promise<void>;
	editLocalComment: (input: { commentId: string; body: string }) => Promise<void>;
	deleteLocalThread: (threadId: string) => Promise<void>;
	deleteLocalComment: (commentId: string) => Promise<void>;
	resolveLocalThread: (input: { threadId: string; resolved: boolean }) => Promise<void>;
	// GitHub review actions.
	addToReview: (localThreadId: string) => Promise<void>;
	submitReview: (input: SubmitReviewBody) => Promise<void>;
	discardReview: () => Promise<void>;
	replyGitHub: (input: GitHubReplyBody) => Promise<void>;
	editGitHubComment: (input: { nodeId: string; body: string }) => Promise<void>;
	deleteGitHubComment: (nodeId: string) => Promise<void>;
	resolveGitHub: (input: { threadNodeId: string; resolved: boolean }) => Promise<void>;
}

/**
 * The run's merged review — local threads plus the PR's live pending/submitted
 * GitHub threads — and the mutations that act on each. Every mutation refetches
 * the merged review, keyed to the run that originated it so a mutation settling
 * after navigation refreshes the right cache entry.
 */
export function useReview(runId: string): UseReviewResult {
	const queryClient = useQueryClient();
	const queryKey = useMemo(() => reviewQueryKey(runId), [runId]);

	const { data, error } = useQuery<ReviewResponse>({
		queryKey,
		queryFn: () => fetchReview(runId),
		enabled: runId !== "",
	});

	const threads = useMemo(() => data?.threads ?? [], [data]);
	const pendingComments = useMemo(() => data?.pendingComments ?? [], [data]);
	const threadsByFile = useMemo(() => groupByFile(threads), [threads]);

	const captureMutationOrigin = (): ReviewMutationOrigin => ({ runId, queryKey });
	const invalidateReview = (origin: ReviewMutationOrigin) =>
		queryClient.invalidateQueries({ queryKey: origin.queryKey });
	// GitHub-affecting actions (submit/resolve/reply/promote) change PR-level state —
	// reviewer decisions, the merge button — that lives behind separate, infinitely-
	// stale query keys. Refresh those in the background; only the review refetch
	// gates the mutation, so a slow checks/deployments read can't hold a composer open.
	const invalidateGitHub = async (origin: ReviewMutationOrigin) => {
		void invalidatePullRequestQueries(queryClient, origin.runId);
		await invalidateReview(origin);
	};

	const runPath = (suffix: string) => `/api/runs/${encodeURIComponent(runId)}${suffix}`;

	const m = {
		createLocalThread: useMutation({
			onMutate: captureMutationOrigin,
			mutationFn: (input: CreateCommentThreadBody) =>
				jsonFetch<unknown>(runPath("/comment-threads"), jsonRequest("POST", input)),
			onSuccess: (_data, _input, origin) => invalidateReview(origin),
		}),
		createGitHubComment: useMutation({
			onMutate: captureMutationOrigin,
			mutationFn: (input: GitHubCommentCreateBody) =>
				jsonFetch(runPath("/review/comment"), jsonRequest("POST", input)),
			onSuccess: (_data, _input, origin) => invalidateGitHub(origin),
		}),
		replyLocal: useMutation({
			onMutate: captureMutationOrigin,
			mutationFn: ({ threadId, body }: { threadId: string; body: string }) =>
				jsonFetch(
					`/api/comment-threads/${encodeURIComponent(threadId)}/replies`,
					jsonRequest("POST", { body }),
				),
			onSuccess: (_data, _input, origin) => invalidateReview(origin),
		}),
		editLocalComment: useMutation({
			onMutate: captureMutationOrigin,
			mutationFn: ({ commentId, body }: { commentId: string; body: string }) =>
				jsonFetch(`/api/comments/${encodeURIComponent(commentId)}`, jsonRequest("PATCH", { body })),
			onSuccess: (_data, _input, origin) => invalidateReview(origin),
		}),
		deleteLocalThread: useMutation({
			onMutate: captureMutationOrigin,
			mutationFn: (threadId: string) =>
				jsonFetch(`/api/comment-threads/${encodeURIComponent(threadId)}`, jsonRequest("DELETE")),
			onSuccess: (_data, _input, origin) => invalidateReview(origin),
		}),
		deleteLocalComment: useMutation({
			onMutate: captureMutationOrigin,
			mutationFn: (commentId: string) =>
				jsonFetch(`/api/comments/${encodeURIComponent(commentId)}`, jsonRequest("DELETE")),
			onSuccess: (_data, _input, origin) => invalidateReview(origin),
		}),
		resolveLocalThread: useMutation({
			onMutate: captureMutationOrigin,
			mutationFn: ({ threadId, resolved }: { threadId: string; resolved: boolean }) =>
				jsonFetch(
					`/api/comment-threads/${encodeURIComponent(threadId)}`,
					jsonRequest("PATCH", { resolved }),
				),
			onSuccess: (_data, _input, origin) => invalidateReview(origin),
		}),
		addToReview: useMutation({
			onMutate: captureMutationOrigin,
			mutationFn: (localThreadId: string) =>
				jsonFetch(runPath("/review/add"), jsonRequest("POST", { localThreadId })),
			onSuccess: (_data, _input, origin) => invalidateGitHub(origin),
		}),
		submitReview: useMutation({
			onMutate: captureMutationOrigin,
			mutationFn: (input: SubmitReviewBody) =>
				jsonFetch(runPath("/review/submit"), jsonRequest("POST", input)),
			onSuccess: (_data, _input, origin) => invalidateGitHub(origin),
		}),
		discardReview: useMutation({
			onMutate: captureMutationOrigin,
			mutationFn: () => jsonFetch(runPath("/review/discard"), jsonRequest("POST")),
			onSuccess: (_data, _input, origin) => invalidateGitHub(origin),
		}),
		replyGitHub: useMutation({
			onMutate: captureMutationOrigin,
			mutationFn: (input: GitHubReplyBody) =>
				jsonFetch(runPath("/review/reply"), jsonRequest("POST", input)),
			onSuccess: (_data, _input, origin) => invalidateGitHub(origin),
		}),
		editGitHubComment: useMutation({
			onMutate: captureMutationOrigin,
			mutationFn: (input: { nodeId: string; body: string }) =>
				jsonFetch(runPath("/review/comment/edit"), jsonRequest("POST", input)),
			onSuccess: (_data, _input, origin) => invalidateGitHub(origin),
		}),
		deleteGitHubComment: useMutation({
			onMutate: captureMutationOrigin,
			mutationFn: (nodeId: string) =>
				jsonFetch(runPath("/review/comment/delete"), jsonRequest("POST", { nodeId })),
			onSuccess: (_data, _input, origin) => invalidateGitHub(origin),
		}),
		resolveGitHub: useMutation({
			onMutate: captureMutationOrigin,
			mutationFn: (input: { threadNodeId: string; resolved: boolean }) =>
				jsonFetch(runPath("/review/resolve"), jsonRequest("POST", input)),
			onSuccess: (_data, _input, origin) => invalidateGitHub(origin),
		}),
	};

	return {
		threads,
		threadsByFile,
		github: data?.github ?? GITHUB_REVIEW_STATUS.NONE,
		pendingComments,
		hasPendingReview: data?.hasPendingReview ?? false,
		pendingReviewBody: data?.pendingReviewBody ?? "",
		isOwnPullRequest: data?.isOwnPullRequest ?? false,
		canWriteToGitHub: data?.canWriteToGitHub ?? false,
		error,
		createLocalThread: m.createLocalThread.mutateAsync,
		createGitHubComment: async (i) => void (await m.createGitHubComment.mutateAsync(i)),
		replyLocal: async (i) => void (await m.replyLocal.mutateAsync(i)),
		editLocalComment: async (i) => void (await m.editLocalComment.mutateAsync(i)),
		deleteLocalThread: async (id) => void (await m.deleteLocalThread.mutateAsync(id)),
		deleteLocalComment: async (id) => void (await m.deleteLocalComment.mutateAsync(id)),
		resolveLocalThread: async (i) => void (await m.resolveLocalThread.mutateAsync(i)),
		addToReview: async (id) => void (await m.addToReview.mutateAsync(id)),
		submitReview: async (i) => void (await m.submitReview.mutateAsync(i)),
		discardReview: async () => void (await m.discardReview.mutateAsync()),
		replyGitHub: async (i) => void (await m.replyGitHub.mutateAsync(i)),
		editGitHubComment: async (i) => void (await m.editGitHubComment.mutateAsync(i)),
		deleteGitHubComment: async (id) => void (await m.deleteGitHubComment.mutateAsync(id)),
		resolveGitHub: async (i) => void (await m.resolveGitHub.mutateAsync(i)),
	};
}

function groupByFile(threads: ReviewThread[]): ReadonlyMap<string, ReviewThread[]> {
	const map = new Map<string, ReviewThread[]>();
	for (const thread of threads) {
		const list = map.get(thread.filePath);
		if (list) list.push(thread);
		else map.set(thread.filePath, [thread]);
	}
	return map;
}
