import { type PullRequestStackResponse, PullRequestStackResponseSchema } from "@stagereview/types";
import { useQuery } from "@tanstack/react-query";
import { jsonFetch } from "@/lib/use-view-state";

/**
 * The stack of open PRs connected to the run's PR, derived server-side from
 * open base→head branch chains. Live PR data: never auto-refetch on
 * focus/reconnect, mirroring the queries in use-pull-request.ts.
 */
export function pullRequestStackQueryKey(runId: string): readonly unknown[] {
	return ["pull-request-stack", runId];
}

export function usePullRequestStack(runId: string, number: number) {
	return useQuery<PullRequestStackResponse>({
		queryKey: [...pullRequestStackQueryKey(runId), number],
		queryFn: async () =>
			PullRequestStackResponseSchema.parse(
				await jsonFetch(
					`/api/runs/${encodeURIComponent(runId)}/pull-request/stack?number=${number}`,
				),
			),
		staleTime: Number.POSITIVE_INFINITY,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});
}
