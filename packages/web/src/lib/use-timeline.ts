import { type TimelineResponse, TimelineResponseSchema } from "@stagereview/types";
import { skipToken, useQuery } from "@tanstack/react-query";
import { jsonFetch } from "@/lib/use-view-state";

/**
 * Full pull-request timeline for the Activity tab. Fetched once per run page
 * load and refreshed on demand like the CLI's other GitHub reads — hosted's
 * live cursor polling is dropped.
 */
export function useTimeline(runId: string, number: number | null) {
	return useQuery<TimelineResponse>({
		queryKey: ["pull-request-timeline", runId, number],
		queryFn:
			number === null
				? skipToken
				: async () =>
						TimelineResponseSchema.parse(
							await jsonFetch(`/api/runs/${encodeURIComponent(runId)}/timeline?number=${number}`),
						),
		staleTime: Number.POSITIVE_INFINITY,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});
}
