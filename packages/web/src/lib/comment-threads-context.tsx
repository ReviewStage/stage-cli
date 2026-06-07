import { createContext, type ReactNode, useContext } from "react";
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
	return <CommentThreadsContext.Provider value={value}>{children}</CommentThreadsContext.Provider>;
}

export function useCommentThreadsContext(): UseCommentThreadsResult {
	const ctx = useContext(CommentThreadsContext);
	if (!ctx) {
		throw new Error("useCommentThreadsContext must be used within a CommentThreadsProvider");
	}
	return ctx;
}
