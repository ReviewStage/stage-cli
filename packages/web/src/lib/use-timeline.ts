import { type TimelineResponse, TimelineResponseSchema } from "@stagereview/types";
import { skipToken, useQuery } from "@tanstack/react-query";
import { jsonFetch } from "@/lib/use-view-state";

/** Prefix key for the run's timeline queries — used for mutation invalidation. */
export function timelineQueryKey(runId: string) {
	return ["pull-request-timeline", runId] as const;
}

/**
 * Full pull-request timeline for the Activity tab. Fetched once per run page
 * load and refreshed on demand like the CLI's other GitHub reads — there is
 * no live polling.
 */
export function useTimeline(runId: string, number: number | null) {
	return useQuery<TimelineResponse>({
		queryKey: [...timelineQueryKey(runId), number],
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
