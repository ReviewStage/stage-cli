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
const GITHUB_LOAD_ERROR_TOAST_ID = "github-threads-error";

/**
 * A failed threads fetch is otherwise indistinguishable from "no comments" — the
 * diff still renders, but the overlay is silently empty. Surface it as a toast
 * (React Query only sets `error` once its retries are exhausted), and dismiss it
 * once a later fetch recovers so a stale message doesn't linger.
 */
function useLoadErrorToast(error: unknown, toastId: string, title: string): void {
	useEffect(() => {
		if (!error) {
			toast.dismiss(toastId);
			return;
		}
		// Stable id so a re-fire (StrictMode double-mount, remount with a cached error,
		// refetch failing with a new error reference) updates one toast instead of stacking.
		toast.error(title, {
			id: toastId,
			description: error instanceof Error ? error.message : undefined,
		});
	}, [error, toastId, title]);
}

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

	useLoadErrorToast(local.error, LOAD_ERROR_TOAST_ID, "Couldn't load comments");
	// Without this the failure looks exactly like a PR with no review comments:
	// no threads, no outdated list, no review toolbar, no explanation.
	useLoadErrorToast(
		github.error,
		GITHUB_LOAD_ERROR_TOAST_ID,
		"Couldn't load GitHub review comments",
	);

	return <CommentThreadsContext.Provider value={value}>{children}</CommentThreadsContext.Provider>;
}

export function useCommentThreadsContext(): CommentThreadsContextValue {
	const ctx = useContext(CommentThreadsContext);
	if (!ctx) {
		throw new Error("useCommentThreadsContext must be used within a CommentThreadsProvider");
	}
	return ctx;
}
