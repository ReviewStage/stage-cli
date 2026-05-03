import { type ChaptersResponse, ChaptersResponseSchema } from "@stage-cli/types/chapters";
import { skipToken, useQuery } from "@tanstack/react-query";
import { jsonFetch } from "@/lib/use-view-state";

async function fetchChapters(runId: string): Promise<ChaptersResponse> {
	// Parse at the boundary — schema drift surfaces here as a query error,
	// not as a render crash deeper in the component tree.
	const raw = await jsonFetch<unknown>(`/api/runs/${encodeURIComponent(runId)}/chapters`);
	return ChaptersResponseSchema.parse(raw);
}

/**
 * Shared chapters query. Multiple components calling this hook with the same
 * runId dedupe to a single network fetch via TanStack Query's cache.
 */
export function useChapters(runId: string | null) {
	return useQuery<ChaptersResponse>({
		queryKey: ["chapters", runId],
		queryFn: runId === null ? skipToken : () => fetchChapters(runId),
	});
}
