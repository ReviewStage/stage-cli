import { createContext, type ReactNode, useContext, useEffect } from "react";
import { toast } from "@/components/ui/sonner";
import { type UseReviewResult, useReview } from "./use-review";

const ReviewContext = createContext<UseReviewResult | null>(null);

const LOAD_ERROR_TOAST_ID = "review-error";

/**
 * Provides the run's merged review (local + GitHub threads) and its mutations to
 * the diff tree without prop-drilling. Mounted once at the run layout.
 */
export function ReviewProvider({ runId, children }: { runId: string; children: ReactNode }) {
	const value = useReview(runId);

	// A failed review fetch is otherwise indistinguishable from "no comments" — the
	// diff still renders but the overlay is silently empty. Surface it as a toast,
	// and dismiss it once a later fetch recovers so a stale message doesn't linger.
	useEffect(() => {
		if (!value.error) {
			toast.dismiss(LOAD_ERROR_TOAST_ID);
			return;
		}
		toast.error("Couldn't load review comments", {
			id: LOAD_ERROR_TOAST_ID,
			description: value.error instanceof Error ? value.error.message : undefined,
		});
	}, [value.error]);

	return <ReviewContext.Provider value={value}>{children}</ReviewContext.Provider>;
}

export function useReviewContext(): UseReviewResult {
	const ctx = useContext(ReviewContext);
	if (!ctx) throw new Error("useReviewContext must be used within a ReviewProvider");
	return ctx;
}
