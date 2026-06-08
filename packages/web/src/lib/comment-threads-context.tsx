import { createContext, type ReactNode, useContext, useEffect } from "react";
import { toast } from "@/components/ui/sonner";
import { type UseCommentThreadsResult, useCommentThreads } from "./use-comment-threads";

const CommentThreadsContext = createContext<UseCommentThreadsResult | null>(null);

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
	const value = useCommentThreads(runId);

	// A failed threads fetch is otherwise indistinguishable from "no comments" —
	// the diff still renders, but the overlay is silently empty. Surface it as a
	// toast (React Query only sets `error` once its retries are exhausted).
	useEffect(() => {
		if (!value.error) return;
		toast.error("Couldn't load comments", {
			description: value.error instanceof Error ? value.error.message : undefined,
		});
	}, [value.error]);

	return <CommentThreadsContext.Provider value={value}>{children}</CommentThreadsContext.Provider>;
}

export function useCommentThreadsContext(): UseCommentThreadsResult {
	const ctx = useContext(CommentThreadsContext);
	if (!ctx) {
		throw new Error("useCommentThreadsContext must be used within a CommentThreadsProvider");
	}
	return ctx;
}
