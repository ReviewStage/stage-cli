import {
	type Comment,
	type CommentThread,
	CommentThreadsResponseSchema,
	type CreateCommentThreadBody,
} from "@stagereview/types/comments";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { jsonFetch } from "./use-view-state";

export type { Comment, CommentThread, CreateCommentThreadBody };

const COMMENT_THREADS_ROOT = "comment-threads";

export function commentThreadsQueryKey(runId: string): readonly unknown[] {
	return [COMMENT_THREADS_ROOT, runId];
}

async function fetchCommentThreads(runId: string): Promise<CommentThread[]> {
	// Parse at the boundary so server-side schema drift surfaces as a query error
	// here, not as a render crash deeper in the diff.
	const raw = await jsonFetch<unknown>(`/api/runs/${encodeURIComponent(runId)}/comment-threads`);
	return CommentThreadsResponseSchema.parse(raw);
}

const jsonRequest = (method: string, body?: unknown): RequestInit => ({
	method,
	headers: { "Content-Type": "application/json" },
	body: body === undefined ? undefined : JSON.stringify(body),
});

export interface UseCommentThreadsResult {
	threads: CommentThread[];
	/** Stable reference; rebuilt only when the underlying query data changes. */
	threadsByFile: ReadonlyMap<string, CommentThread[]>;
	isLoading: boolean;
	error: unknown;
	createThread: (input: CreateCommentThreadBody) => Promise<CommentThread>;
	replyToThread: (input: { threadId: string; body: string }) => Promise<void>;
	setThreadResolved: (input: { threadId: string; resolved: boolean }) => Promise<void>;
	editComment: (input: { commentId: string; body: string }) => Promise<void>;
	deleteThread: (threadId: string) => Promise<void>;
	deleteComment: (commentId: string) => Promise<void>;
}

/**
 * Loads the comment threads anchored to a run's diff scope and exposes the
 * thread/comment mutations. The local server commits synchronously, so each
 * mutation simply invalidates the query rather than maintaining optimistic
 * caches — the refetch round-trip is effectively instant.
 */
export function useCommentThreads(runId: string): UseCommentThreadsResult {
	const queryClient = useQueryClient();
	const queryKey = useMemo(() => commentThreadsQueryKey(runId), [runId]);

	const { data, isLoading, error } = useQuery<CommentThread[]>({
		queryKey,
		queryFn: () => fetchCommentThreads(runId),
		enabled: runId !== "",
	});

	const threads = useMemo(() => data ?? [], [data]);
	const threadsByFile = useMemo(() => groupByFile(threads), [threads]);

	const invalidate = () => queryClient.invalidateQueries({ queryKey });

	const createMutation = useMutation({
		mutationFn: (input: CreateCommentThreadBody) =>
			jsonFetch<CommentThread>(
				`/api/runs/${encodeURIComponent(runId)}/comment-threads`,
				jsonRequest("POST", input),
			),
		onSuccess: invalidate,
	});

	const replyMutation = useMutation({
		mutationFn: async ({ threadId, body }: { threadId: string; body: string }) => {
			await jsonFetch(
				`/api/comment-threads/${encodeURIComponent(threadId)}/replies`,
				jsonRequest("POST", { body }),
			);
		},
		onSuccess: invalidate,
	});

	const resolveMutation = useMutation({
		mutationFn: async ({ threadId, resolved }: { threadId: string; resolved: boolean }) => {
			// Run-scoped: the server mirrors the toggle to GitHub for PR-originated threads.
			await jsonFetch(
				`/api/runs/${encodeURIComponent(runId)}/comment-threads/${encodeURIComponent(threadId)}`,
				jsonRequest("PATCH", { resolved }),
			);
		},
		onSuccess: invalidate,
	});

	const editMutation = useMutation({
		mutationFn: async ({ commentId, body }: { commentId: string; body: string }) => {
			await jsonFetch(
				`/api/comments/${encodeURIComponent(commentId)}`,
				jsonRequest("PATCH", { body }),
			);
		},
		onSuccess: invalidate,
	});

	const deleteThreadMutation = useMutation({
		mutationFn: async (threadId: string) => {
			await jsonFetch(
				`/api/comment-threads/${encodeURIComponent(threadId)}`,
				jsonRequest("DELETE"),
			);
		},
		onSuccess: invalidate,
	});

	const deleteCommentMutation = useMutation({
		mutationFn: async (commentId: string) => {
			await jsonFetch(`/api/comments/${encodeURIComponent(commentId)}`, jsonRequest("DELETE"));
		},
		onSuccess: invalidate,
	});

	return useMemo(
		() => ({
			threads,
			threadsByFile,
			isLoading,
			error,
			createThread: createMutation.mutateAsync,
			replyToThread: replyMutation.mutateAsync,
			setThreadResolved: resolveMutation.mutateAsync,
			editComment: editMutation.mutateAsync,
			deleteThread: deleteThreadMutation.mutateAsync,
			deleteComment: deleteCommentMutation.mutateAsync,
		}),
		[
			threads,
			threadsByFile,
			isLoading,
			error,
			createMutation.mutateAsync,
			replyMutation.mutateAsync,
			resolveMutation.mutateAsync,
			editMutation.mutateAsync,
			deleteThreadMutation.mutateAsync,
			deleteCommentMutation.mutateAsync,
		],
	);
}

function groupByFile(threads: CommentThread[]): ReadonlyMap<string, CommentThread[]> {
	const map = new Map<string, CommentThread[]>();
	for (const thread of threads) {
		const list = map.get(thread.filePath);
		if (list) list.push(thread);
		else map.set(thread.filePath, [thread]);
	}
	return map;
}
