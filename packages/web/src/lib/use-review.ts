import {
	CommentThreadsResponseSchema,
	type CreateCommentThreadBody,
	type CommentThread as LocalCommentThread,
} from "@stagereview/types/comments";
import {
	COMMENT_STATE,
	GITHUB_REVIEW_STATUS,
	type GitHubReviewStatus,
	type PendingReviewComment,
	type ReviewEvent,
	type ReviewResponse,
	ReviewResponseSchema,
	type ReviewThread,
	THREAD_SOURCE,
} from "@stagereview/types/review";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useInvalidatePullRequest } from "./pull-request-mutations";
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

async function fetchLocalThreads(runId: string): Promise<ReviewThread[]> {
	const raw = await jsonFetch<unknown>(`/api/runs/${encodeURIComponent(runId)}/comment-threads`);
	return CommentThreadsResponseSchema.parse(raw).map(toReviewThread);
}

function toReviewThread(thread: LocalCommentThread): ReviewThread {
	return {
		id: thread.id,
		source: THREAD_SOURCE.LOCAL,
		threadNodeId: null,
		filePath: thread.filePath,
		side: thread.side,
		startLine: thread.startLine,
		endLine: thread.endLine,
		isResolved: thread.resolvedAt !== null,
		comments: thread.comments.map((comment) => ({
			id: comment.id,
			state: COMMENT_STATE.LOCAL,
			body: comment.body,
			bodyHtml: null,
			author: null,
			nodeId: null,
			htmlUrl: null,
			createdAt: comment.createdAt,
		})),
	};
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
	pendingCommentCount: number;
	hasPendingReview: boolean;
	pendingReviewBody: string;
	isOwnPullRequest: boolean;
	canPushToReview: boolean;
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
 * GitHub threads — and the mutations that act on each. Local mutations refresh only
 * the local endpoint and merge those rows into the cache, so a transient GitHub
 * outage cannot evict cached PR threads. GitHub mutations refetch the merged review.
 */
export function useReview(runId: string): UseReviewResult {
	const queryClient = useQueryClient();
	const invalidatePullRequest = useInvalidatePullRequest(runId);
	const queryKey = useMemo(() => reviewQueryKey(runId), [runId]);
	const [localOverlay, setLocalOverlay] = useState<{
		runId: string;
		threads: ReviewThread[];
	} | null>(null);

	const { data, isLoading, error } = useQuery<ReviewResponse>({
		queryKey,
		queryFn: () => fetchReview(runId),
		enabled: runId !== "",
	});

	const refreshedLocalThreads = localOverlay?.runId === runId ? localOverlay.threads : null;
	const threads = useMemo(() => {
		const reviewThreads = data?.threads ?? [];
		if (refreshedLocalThreads === null) return reviewThreads;
		return [
			...refreshedLocalThreads,
			...reviewThreads.filter((thread) => thread.source !== THREAD_SOURCE.LOCAL),
		];
	}, [data, refreshedLocalThreads]);
	const pendingComments = useMemo(() => data?.pendingComments ?? [], [data]);
	const threadsByFile = useMemo(() => groupByFile(threads), [threads]);
	const invalidate = () => queryClient.invalidateQueries({ queryKey });
	const refreshLocal = () => {
		// The write already succeeded. Refreshing its local projection is best-effort
		// and must not reject mutateAsync (which could prompt a duplicate retry).
		void fetchLocalThreads(runId)
			.then((localThreads) => setLocalOverlay({ runId, threads: localThreads }))
			.catch(() => {});
	};
	const removePromotedLocalThread = (localThreadId: string) => {
		setLocalOverlay((current) => {
			const localThreads =
				current?.runId === runId
					? current.threads
					: (queryClient
							.getQueryData<ReviewResponse>(queryKey)
							?.threads.filter((thread) => thread.source === THREAD_SOURCE.LOCAL) ?? []);
			return {
				runId,
				threads: localThreads.filter((thread) => thread.id !== localThreadId),
			};
		});
	};
	// GitHub-affecting actions (submit/resolve/reply/promote) change PR-level state —
	// reviewer decisions, the merge button — that lives behind separate, infinitely-
	// stale query keys. Refresh those too so the PR header doesn't go stale until reload.
	const invalidateGitHub = () => {
		invalidate();
		void invalidatePullRequest();
	};

	const runPath = (suffix: string) => `/api/runs/${encodeURIComponent(runId)}${suffix}`;

	const m = {
		createLocalThread: useMutation({
			mutationFn: (input: CreateCommentThreadBody) =>
				jsonFetch<unknown>(runPath("/comment-threads"), jsonRequest("POST", input)),
			onSuccess: refreshLocal,
		}),
		createPendingComment: useMutation({
			mutationFn: (input: CreateCommentThreadBody) =>
				jsonFetch(runPath("/review/comment"), jsonRequest("POST", input)),
			onSuccess: invalidateGitHub,
		}),
		replyLocal: useMutation({
			mutationFn: ({ threadId, body }: { threadId: string; body: string }) =>
				jsonFetch(
					`/api/comment-threads/${encodeURIComponent(threadId)}/replies`,
					jsonRequest("POST", { body }),
				),
			onSuccess: refreshLocal,
		}),
		editLocalComment: useMutation({
			mutationFn: ({ commentId, body }: { commentId: string; body: string }) =>
				jsonFetch(`/api/comments/${encodeURIComponent(commentId)}`, jsonRequest("PATCH", { body })),
			onSuccess: refreshLocal,
		}),
		deleteLocalThread: useMutation({
			mutationFn: (threadId: string) =>
				jsonFetch(`/api/comment-threads/${encodeURIComponent(threadId)}`, jsonRequest("DELETE")),
			onSuccess: refreshLocal,
		}),
		deleteLocalComment: useMutation({
			mutationFn: (commentId: string) =>
				jsonFetch(`/api/comments/${encodeURIComponent(commentId)}`, jsonRequest("DELETE")),
			onSuccess: refreshLocal,
		}),
		resolveLocalThread: useMutation({
			mutationFn: ({ threadId, resolved }: { threadId: string; resolved: boolean }) =>
				jsonFetch(
					`/api/comment-threads/${encodeURIComponent(threadId)}`,
					jsonRequest("PATCH", { resolved }),
				),
			onSuccess: refreshLocal,
		}),
		addToReview: useMutation({
			mutationFn: (localThreadId: string) =>
				jsonFetch(runPath("/review/add"), jsonRequest("POST", { localThreadId })),
			onSuccess: (_data, localThreadId) => {
				removePromotedLocalThread(localThreadId);
				refreshLocal();
				invalidateGitHub();
			},
		}),
		submitReview: useMutation({
			mutationFn: (input: { event: ReviewEvent; body: string }) =>
				jsonFetch(runPath("/review/submit"), jsonRequest("POST", input)),
			onSuccess: invalidateGitHub,
		}),
		discardReview: useMutation({
			mutationFn: () => jsonFetch(runPath("/review/discard"), jsonRequest("POST")),
			onSuccess: invalidateGitHub,
		}),
		replyGitHub: useMutation({
			mutationFn: (input: { threadNodeId: string; body: string; pending: boolean }) =>
				jsonFetch(runPath("/review/reply"), jsonRequest("POST", input)),
			onSuccess: invalidateGitHub,
		}),
		editGitHubComment: useMutation({
			mutationFn: (input: { nodeId: string; body: string }) =>
				jsonFetch(runPath("/review/comment/edit"), jsonRequest("POST", input)),
			onSuccess: invalidateGitHub,
		}),
		deleteGitHubComment: useMutation({
			mutationFn: (nodeId: string) =>
				jsonFetch(runPath("/review/comment/delete"), jsonRequest("POST", { nodeId })),
			onSuccess: invalidateGitHub,
		}),
		resolveGitHub: useMutation({
			mutationFn: (input: { threadNodeId: string; resolved: boolean }) =>
				jsonFetch(runPath("/review/resolve"), jsonRequest("POST", input)),
			onSuccess: invalidateGitHub,
		}),
	};

	return {
		threads,
		threadsByFile,
		github: data?.github ?? GITHUB_REVIEW_STATUS.NONE,
		pendingComments,
		pendingCommentCount: data?.pendingCommentCount ?? 0,
		hasPendingReview: data?.hasPendingReview ?? false,
		pendingReviewBody: data?.pendingReviewBody ?? "",
		isOwnPullRequest: data?.isOwnPullRequest ?? false,
		canPushToReview: data?.canPushToReview ?? false,
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
