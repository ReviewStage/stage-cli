import type { CreateCommentThreadBody } from "@stagereview/types/comments";
import {
	GITHUB_REVIEW_STATUS,
	type GitHubReviewStatus,
	type ReviewEvent,
	type ReviewResponse,
	ReviewResponseSchema,
	type ReviewThread,
} from "@stagereview/types/review";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { jsonFetch } from "./use-view-state";

export type { CreateCommentThreadBody, GitHubReviewStatus, ReviewEvent, ReviewThread };
export { GITHUB_REVIEW_STATUS };

const REVIEW_ROOT = "review";

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
	pendingCommentCount: number;
	hasPendingReview: boolean;
	isLoading: boolean;
	error: unknown;
	// Local comments (CLI-only, work offline).
	createLocalThread: (input: CreateCommentThreadBody) => Promise<unknown>;
	// Create a comment directly on the PR as a pending review comment.
	createPendingComment: (input: CreateCommentThreadBody) => Promise<void>;
	replyLocal: (input: { threadId: string; body: string }) => Promise<void>;
	editLocalComment: (input: { commentId: string; body: string }) => Promise<void>;
	deleteLocalThread: (threadId: string) => Promise<void>;
	deleteLocalComment: (commentId: string) => Promise<void>;
	resolveLocalThread: (input: { threadId: string; resolved: boolean }) => Promise<void>;
	// GitHub review actions.
	addToReview: (localThreadId: string) => Promise<void>;
	submitReview: (input: { event: ReviewEvent; body: string }) => Promise<void>;
	discardReview: () => Promise<void>;
	replyGitHub: (input: { threadNodeId: string; body: string; pending: boolean }) => Promise<void>;
	editGitHubComment: (input: { nodeId: string; body: string }) => Promise<void>;
	deleteGitHubComment: (nodeId: string) => Promise<void>;
	resolveGitHub: (input: { threadNodeId: string; resolved: boolean }) => Promise<void>;
}

/**
 * The run's merged review — local threads plus the PR's live pending/submitted
 * GitHub threads — and the mutations that act on each. Every mutation invalidates
 * the review query so the merged view refetches (the local server commits
 * synchronously and GitHub round-trips are quick), keeping local and GitHub in step.
 */
export function useReview(runId: string): UseReviewResult {
	const queryClient = useQueryClient();
	const queryKey = useMemo(() => reviewQueryKey(runId), [runId]);

	const { data, isLoading, error } = useQuery<ReviewResponse>({
		queryKey,
		queryFn: () => fetchReview(runId),
		enabled: runId !== "",
	});

	const threads = useMemo(() => data?.threads ?? [], [data]);
	const threadsByFile = useMemo(() => groupByFile(threads), [threads]);
	const invalidate = () => queryClient.invalidateQueries({ queryKey });

	const runPath = (suffix: string) => `/api/runs/${encodeURIComponent(runId)}${suffix}`;

	const m = {
		createLocalThread: useMutation({
			mutationFn: (input: CreateCommentThreadBody) =>
				jsonFetch<unknown>(runPath("/comment-threads"), jsonRequest("POST", input)),
			onSuccess: invalidate,
		}),
		createPendingComment: useMutation({
			mutationFn: (input: CreateCommentThreadBody) =>
				jsonFetch(runPath("/review/comment"), jsonRequest("POST", input)),
			onSuccess: invalidate,
		}),
		replyLocal: useMutation({
			mutationFn: ({ threadId, body }: { threadId: string; body: string }) =>
				jsonFetch(
					`/api/comment-threads/${encodeURIComponent(threadId)}/replies`,
					jsonRequest("POST", { body }),
				),
			onSuccess: invalidate,
		}),
		editLocalComment: useMutation({
			mutationFn: ({ commentId, body }: { commentId: string; body: string }) =>
				jsonFetch(`/api/comments/${encodeURIComponent(commentId)}`, jsonRequest("PATCH", { body })),
			onSuccess: invalidate,
		}),
		deleteLocalThread: useMutation({
			mutationFn: (threadId: string) =>
				jsonFetch(`/api/comment-threads/${encodeURIComponent(threadId)}`, jsonRequest("DELETE")),
			onSuccess: invalidate,
		}),
		deleteLocalComment: useMutation({
			mutationFn: (commentId: string) =>
				jsonFetch(`/api/comments/${encodeURIComponent(commentId)}`, jsonRequest("DELETE")),
			onSuccess: invalidate,
		}),
		resolveLocalThread: useMutation({
			mutationFn: ({ threadId, resolved }: { threadId: string; resolved: boolean }) =>
				jsonFetch(
					runPath(`/comment-threads/${encodeURIComponent(threadId)}`),
					jsonRequest("PATCH", { resolved }),
				),
			onSuccess: invalidate,
		}),
		addToReview: useMutation({
			mutationFn: (localThreadId: string) =>
				jsonFetch(runPath("/review/add"), jsonRequest("POST", { localThreadId })),
			onSuccess: invalidate,
		}),
		submitReview: useMutation({
			mutationFn: (input: { event: ReviewEvent; body: string }) =>
				jsonFetch(runPath("/review/submit"), jsonRequest("POST", input)),
			onSuccess: invalidate,
		}),
		discardReview: useMutation({
			mutationFn: () => jsonFetch(runPath("/review/discard"), jsonRequest("POST")),
			onSuccess: invalidate,
		}),
		replyGitHub: useMutation({
			mutationFn: (input: { threadNodeId: string; body: string; pending: boolean }) =>
				jsonFetch(runPath("/review/reply"), jsonRequest("POST", input)),
			onSuccess: invalidate,
		}),
		editGitHubComment: useMutation({
			mutationFn: (input: { nodeId: string; body: string }) =>
				jsonFetch(runPath("/review/comment/edit"), jsonRequest("POST", input)),
			onSuccess: invalidate,
		}),
		deleteGitHubComment: useMutation({
			mutationFn: (nodeId: string) =>
				jsonFetch(runPath("/review/comment/delete"), jsonRequest("POST", { nodeId })),
			onSuccess: invalidate,
		}),
		resolveGitHub: useMutation({
			mutationFn: (input: { threadNodeId: string; resolved: boolean }) =>
				jsonFetch(runPath("/review/resolve"), jsonRequest("POST", input)),
			onSuccess: invalidate,
		}),
	};

	return {
		threads,
		threadsByFile,
		github: data?.github ?? GITHUB_REVIEW_STATUS.NONE,
		pendingCommentCount: data?.pendingCommentCount ?? 0,
		hasPendingReview: data?.hasPendingReview ?? false,
		isLoading,
		error,
		createLocalThread: m.createLocalThread.mutateAsync,
		createPendingComment: async (i) => void (await m.createPendingComment.mutateAsync(i)),
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
