import { createContext, type ReactNode, useContext, useEffect, useMemo } from "react";
import { toast } from "@/components/ui/sonner";
import { type MergedThreads, mergeThreads } from "./merge-threads";
import { type UseCommentThreadsResult, useCommentThreads } from "./use-comment-threads";
import { type UseGitHubThreadsResult, useGitHubThreads } from "./use-github-threads";

export interface CommentThreadsContextValue extends UseCommentThreadsResult {
	/** GitHub review threads for the run's PR, plus their mutations. */
	github: UseGitHubThreadsResult;
	/** Local + GitHub threads combined into what the diff should render. */
	merged: MergedThreads;
}

const CommentThreadsContext = createContext<CommentThreadsContextValue | null>(null);

const LOAD_ERROR_TOAST_ID = "comment-threads-error";

/**
 * Provides the run's comment threads + mutations to the diff tree without
 * prop-drilling through FileDiffList. Mounted once at the run layout.
 */
export function CommentThreadsProvider({
	runId,
	children,
}: {
	runId: string;
	children: ReactNode;
}) {
	const local = useCommentThreads(runId);
	const github = useGitHubThreads(runId);
	const { threads } = local;
	// `available: false` means gh is missing or the run has no PR — its (empty)
	// thread list is meaningless then, so don't merge it.
	const merged = useMemo(
		() => mergeThreads(threads, github.available ? github.threads : []),
		[threads, github.available, github.threads],
	);
	const value = useMemo<CommentThreadsContextValue>(
		() => ({ ...local, github, merged }),
		[local, github, merged],
	);

	// A failed threads fetch is otherwise indistinguishable from "no comments" —
	// the diff still renders, but the overlay is silently empty. Surface it as a
	// toast (React Query only sets `error` once its retries are exhausted), and
	// dismiss it once a later fetch recovers so a stale message doesn't linger.
	useEffect(() => {
		if (!value.error) {
			toast.dismiss(LOAD_ERROR_TOAST_ID);
			return;
		}
		// Stable id so a re-fire (StrictMode double-mount, remount with a cached error,
		// refetch failing with a new error reference) updates one toast instead of stacking.
		toast.error("Couldn't load comments", {
			id: LOAD_ERROR_TOAST_ID,
			description: value.error instanceof Error ? value.error.message : undefined,
		});
	}, [value.error]);

	return <CommentThreadsContext.Provider value={value}>{children}</CommentThreadsContext.Provider>;
}

export function useCommentThreadsContext(): CommentThreadsContextValue {
	const ctx = useContext(CommentThreadsContext);
	if (!ctx) {
		throw new Error("useCommentThreadsContext must be used within a CommentThreadsProvider");
	}
	return ctx;
}
