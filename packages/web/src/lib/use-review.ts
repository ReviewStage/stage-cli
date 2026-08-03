import {
	CommentSchema,
	CommentThreadSchema,
	CommentThreadsResponseSchema,
	type CreateCommentThreadBody,
	type Comment as LocalComment,
	type CommentThread as LocalCommentThread,
} from "@stagereview/types/comments";
import {
	COMMENT_STATE,
	GITHUB_REVIEW_STATUS,
	type GitHubCommentCreateBody,
	type GitHubReplyBody,
	type GitHubReviewStatus,
	type LocalReviewComment,
	type LocalReviewThread,
	type PendingReviewComment,
	type ReviewEvent,
	type ReviewResponse,
	ReviewResponseSchema,
	type ReviewThread,
	type SubmitReviewBody,
	THREAD_SOURCE,
} from "@stagereview/types/review";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { jsonFetch } from "./use-view-state";

export type { CreateCommentThreadBody, GitHubReviewStatus, ReviewEvent, ReviewThread };
export { GITHUB_REVIEW_STATUS };

const REVIEW_ROOT = "review";

interface ReviewQueryData {
	generation: number;
	review: ReviewResponse;
	lastAvailableReview?: ReviewResponse;
}

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

async function fetchLocalThreads(runId: string): Promise<LocalReviewThread[]> {
	const raw = await jsonFetch<unknown>(`/api/runs/${encodeURIComponent(runId)}/comment-threads`);
	return CommentThreadsResponseSchema.parse(raw).map(toReviewThread);
}

function toReviewComment(comment: LocalComment): LocalReviewComment {
	return {
		id: comment.id,
		state: COMMENT_STATE.LOCAL,
		body: comment.body,
		bodyHtml: null,
		author: null,
		nodeId: null,
		htmlUrl: null,
		createdAt: comment.createdAt,
	};
}

function toReviewThread(thread: LocalCommentThread): LocalReviewThread {
	return {
		id: thread.id,
		source: THREAD_SOURCE.LOCAL,
		threadNodeId: null,
		hasPromotionRecovery: thread.hasPromotionRecovery,
		filePath: thread.filePath,
		side: thread.side,
		startLine: thread.startLine,
		endLine: thread.endLine,
		isResolved: thread.resolvedAt !== null,
		comments: thread.comments.map(toReviewComment),
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
	canWriteToGitHub: boolean;
	isLoading: boolean;
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
 * GitHub threads — and the mutations that act on each. Local mutations refresh only
 * the local endpoint and merge those rows into the cache, so a transient GitHub
 * outage cannot evict cached PR threads. GitHub mutations refetch the merged review.
 */
export function useReview(runId: string): UseReviewResult {
	const queryClient = useQueryClient();
	const queryKey = useMemo(() => reviewQueryKey(runId), [runId]);
	const [localOverlay, setLocalOverlay] = useState<{
		runId: string;
		threads: LocalReviewThread[];
		reviewGeneration: number;
	} | null>(null);
	const localRefreshGeneration = useRef(0);
	const reviewRequestGeneration = useRef(0);

	const {
		data: queryData,
		isLoading,
		error,
	} = useQuery<ReviewQueryData>({
		queryKey,
		queryFn: async () => {
			const generation = ++reviewRequestGeneration.current;
			const review = await fetchReview(runId);
			const cached =
				review.github === GITHUB_REVIEW_STATUS.AVAILABLE
					? review
					: review.github === GITHUB_REVIEW_STATUS.OFFLINE
						? queryClient.getQueryData<ReviewQueryData>(queryKey)?.lastAvailableReview
						: undefined;
			return {
				generation,
				review:
					review.github === GITHUB_REVIEW_STATUS.OFFLINE && cached
						? mergeOfflineReview(review, cached)
						: review,
				lastAvailableReview: cached,
			};
		},
		enabled: runId !== "",
	});

	const data = queryData?.review;
	const completedReviewGeneration = queryData?.generation ?? 0;
	const refreshedLocalThreads =
		localOverlay?.runId === runId && localOverlay.reviewGeneration >= completedReviewGeneration
			? localOverlay.threads
			: null;
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
	const updateLocalThreads = (update: (threads: LocalReviewThread[]) => LocalReviewThread[]) => {
		const generation = ++localRefreshGeneration.current;
		const reviewGeneration = reviewRequestGeneration.current;
		setLocalOverlay((current) => {
			const cachedReview = queryClient.getQueryData<ReviewQueryData>(queryKey);
			const localThreads =
				current?.runId === runId && current.reviewGeneration >= (cachedReview?.generation ?? 0)
					? current.threads
					: (cachedReview?.review.threads.filter(
							(thread): thread is LocalReviewThread => thread.source === THREAD_SOURCE.LOCAL,
						) ?? []);
			return { runId, threads: update(localThreads), reviewGeneration };
		});
		// The mutation response above is authoritative. This best-effort read fills
		// any rows not yet cached, but only the newest mutation may reconcile state.
		void fetchLocalThreads(runId)
			.then((localThreads) => {
				if (localRefreshGeneration.current !== generation) return;
				setLocalOverlay({ runId, threads: localThreads, reviewGeneration });
			})
			.catch(() => {});
	};
	const captureMutationOrigin = (): ReviewMutationOrigin => ({ runId, queryKey });
	const updateLocalThreadsForOrigin = (
		origin: ReviewMutationOrigin,
		update: (threads: LocalReviewThread[]) => LocalReviewThread[],
	) => {
		if (origin.runId === runId) {
			updateLocalThreads(update);
			return;
		}
		// A mutation may settle after this hook navigates to another run. Reconcile
		// only the cache entry that originated the request; never put A's rows into
		// B's component-local overlay.
		queryClient.setQueryData<ReviewQueryData>(origin.queryKey, (current) => {
			if (!current) return current;
			const localThreads = current.review.threads.filter(
				(thread): thread is LocalReviewThread => thread.source === THREAD_SOURCE.LOCAL,
			);
			return {
				...current,
				review: {
					...current.review,
					threads: [
						...update(localThreads),
						...current.review.threads.filter((thread) => thread.source !== THREAD_SOURCE.LOCAL),
					],
				},
			};
		});
		void queryClient.invalidateQueries({ queryKey: origin.queryKey, refetchType: "none" });
	};
	const removePromotedLocalThread = (origin: ReviewMutationOrigin, localThreadId: string) => {
		updateLocalThreadsForOrigin(origin, (threads) =>
			threads.filter((thread) => thread.id !== localThreadId),
		);
	};
	// GitHub-affecting actions (submit/resolve/reply/promote) change PR-level state —
	// reviewer decisions, the merge button — that lives behind separate, infinitely-
	// stale query keys. Refresh those too so the PR header doesn't go stale until reload.
	const invalidateGitHub = async (origin: ReviewMutationOrigin) => {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: origin.queryKey }),
			queryClient.invalidateQueries({ queryKey: ["pull-request", origin.runId] }),
			queryClient.invalidateQueries({ queryKey: ["pull-request-reviews", origin.runId] }),
			queryClient.invalidateQueries({ queryKey: ["pull-request-merge-status", origin.runId] }),
			queryClient.invalidateQueries({ queryKey: ["pull-request-checks", origin.runId] }),
		]);
	};

	const runPath = (suffix: string) => `/api/runs/${encodeURIComponent(runId)}${suffix}`;

	const m = {
		createLocalThread: useMutation({
			onMutate: captureMutationOrigin,
			mutationFn: async (input: CreateCommentThreadBody) =>
				CommentThreadSchema.parse(
					await jsonFetch<unknown>(runPath("/comment-threads"), jsonRequest("POST", input)),
				),
			onSuccess: (thread, _input, origin) =>
				updateLocalThreadsForOrigin(origin, (threads) =>
					threads.some((current) => current.id === thread.id)
						? threads
						: [...threads, toReviewThread(thread)],
				),
		}),
		createGitHubComment: useMutation({
			onMutate: captureMutationOrigin,
			mutationFn: (input: GitHubCommentCreateBody) =>
				jsonFetch(runPath("/review/comment"), jsonRequest("POST", input)),
			onSuccess: (_data, _input, origin) => invalidateGitHub(origin),
		}),
		replyLocal: useMutation({
			onMutate: captureMutationOrigin,
			mutationFn: async ({ threadId, body }: { threadId: string; body: string }) =>
				CommentSchema.parse(
					await jsonFetch(
						`/api/comment-threads/${encodeURIComponent(threadId)}/replies`,
						jsonRequest("POST", { body }),
					),
				),
			onSuccess: (comment, { threadId }, origin) =>
				updateLocalThreadsForOrigin(origin, (threads) =>
					threads.map((thread) => {
						if (
							thread.id !== threadId ||
							thread.comments.some((current) => current.id === comment.id)
						) {
							return thread;
						}
						return { ...thread, comments: [...thread.comments, toReviewComment(comment)] };
					}),
				),
		}),
		editLocalComment: useMutation({
			onMutate: captureMutationOrigin,
			mutationFn: async ({ commentId, body }: { commentId: string; body: string }) =>
				CommentSchema.parse(
					await jsonFetch(
						`/api/comments/${encodeURIComponent(commentId)}`,
						jsonRequest("PATCH", { body }),
					),
				),
			onSuccess: (comment, _input, origin) =>
				updateLocalThreadsForOrigin(origin, (threads) =>
					threads.map((thread) => ({
						...thread,
						comments: thread.comments.map((current) =>
							current.id === comment.id ? toReviewComment(comment) : current,
						),
					})),
				),
		}),
		deleteLocalThread: useMutation({
			onMutate: captureMutationOrigin,
			mutationFn: (threadId: string) =>
				jsonFetch(`/api/comment-threads/${encodeURIComponent(threadId)}`, jsonRequest("DELETE")),
			onSuccess: (_data, threadId, origin) =>
				updateLocalThreadsForOrigin(origin, (threads) =>
					threads.filter((thread) => thread.id !== threadId),
				),
		}),
		deleteLocalComment: useMutation({
			onMutate: captureMutationOrigin,
			mutationFn: (commentId: string) =>
				jsonFetch(`/api/comments/${encodeURIComponent(commentId)}`, jsonRequest("DELETE")),
			onSuccess: (_data, commentId, origin) =>
				updateLocalThreadsForOrigin(origin, (threads) =>
					threads.flatMap((thread) => {
						const comments = thread.comments.filter((comment) => comment.id !== commentId);
						return comments.length === 0 ? [] : [{ ...thread, comments }];
					}),
				),
		}),
		resolveLocalThread: useMutation({
			onMutate: captureMutationOrigin,
			mutationFn: async ({ threadId, resolved }: { threadId: string; resolved: boolean }) =>
				CommentThreadSchema.parse(
					await jsonFetch(
						`/api/comment-threads/${encodeURIComponent(threadId)}`,
						jsonRequest("PATCH", { resolved }),
					),
				),
			onSuccess: (updated, _input, origin) =>
				updateLocalThreadsForOrigin(origin, (threads) =>
					threads.map((thread) => (thread.id === updated.id ? toReviewThread(updated) : thread)),
				),
		}),
		addToReview: useMutation({
			onMutate: captureMutationOrigin,
			mutationFn: (localThreadId: string) =>
				jsonFetch(runPath("/review/add"), jsonRequest("POST", { localThreadId })),
			onSuccess: (_data, localThreadId, origin) => {
				removePromotedLocalThread(origin, localThreadId);
				return invalidateGitHub(origin);
			},
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
		pendingCommentCount: data?.pendingCommentCount ?? 0,
		hasPendingReview: data?.hasPendingReview ?? false,
		pendingReviewBody: data?.pendingReviewBody ?? "",
		isOwnPullRequest: data?.isOwnPullRequest ?? false,
		canPushToReview: data?.canPushToReview ?? false,
		canWriteToGitHub: data?.canWriteToGitHub ?? false,
		isLoading,
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

function mergeOfflineReview(offline: ReviewResponse, cached: ReviewResponse): ReviewResponse {
	return {
		...offline,
		threads: [
			...offline.threads.filter((thread) => thread.source === THREAD_SOURCE.LOCAL),
			...cached.threads.filter((thread) => thread.source === THREAD_SOURCE.GITHUB),
		],
		pendingComments: cached.pendingComments,
		pendingCommentCount: cached.pendingCommentCount,
		hasPendingReview: cached.hasPendingReview,
		pendingReviewBody: cached.pendingReviewBody,
		isOwnPullRequest: cached.isOwnPullRequest,
		canPushToReview: false,
		canWriteToGitHub: false,
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
