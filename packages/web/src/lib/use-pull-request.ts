import {
	type ChecksResponse,
	ChecksResponseSchema,
	type CollaboratorsResponse,
	CollaboratorsResponseSchema,
	type MergeStatusResponse,
	MergeStatusResponseSchema,
	type PullRequestResponse,
	PullRequestResponseSchema,
	type ReviewsResponse,
	ReviewsResponseSchema,
} from "@stagereview/types/pull-request";
import { skipToken, useQuery } from "@tanstack/react-query";
import { jsonFetch } from "@/lib/use-view-state";

// Live PR data: never auto-refetch on focus/reconnect (the CLI is local and
// the data is cheap to refetch explicitly). Mirrors hosted's live query opts.
const LIVE = {
	staleTime: Number.POSITIVE_INFINITY,
	refetchOnWindowFocus: false,
	refetchOnReconnect: false,
} as const;

function prPath(runId: string, suffix = ""): string {
	return `/api/runs/${encodeURIComponent(runId)}/pull-request${suffix}`;
}

export function usePullRequest(runId: string | null) {
	return useQuery<PullRequestResponse>({
		queryKey: ["pull-request", runId],
		queryFn:
			runId === null
				? skipToken
				: async () => PullRequestResponseSchema.parse(await jsonFetch(prPath(runId))),
		...LIVE,
	});
}

export function usePullRequestChecks(runId: string, headSha: string | null, enabled: boolean) {
	return useQuery<ChecksResponse>({
		queryKey: ["pull-request-checks", runId, headSha],
		queryFn:
			!enabled || headSha === null
				? skipToken
				: async () =>
						ChecksResponseSchema.parse(
							await jsonFetch(prPath(runId, `/checks?headSha=${encodeURIComponent(headSha)}`)),
						),
		...LIVE,
	});
}

export function usePullRequestReviews(runId: string, number: number | null) {
	return useQuery<ReviewsResponse>({
		queryKey: ["pull-request-reviews", runId, number],
		queryFn:
			number === null
				? skipToken
				: async () =>
						ReviewsResponseSchema.parse(
							await jsonFetch(prPath(runId, `/reviews?number=${number}`)),
						),
		...LIVE,
	});
}

export function usePullRequestMergeStatus(runId: string, number: number | null, enabled: boolean) {
	return useQuery<MergeStatusResponse>({
		queryKey: ["pull-request-merge-status", runId, number],
		queryFn:
			!enabled || number === null
				? skipToken
				: async () =>
						MergeStatusResponseSchema.parse(
							await jsonFetch(prPath(runId, `/merge-status?number=${number}`)),
						),
		...LIVE,
	});
}

export function usePullRequestCollaborators(runId: string, enabled: boolean) {
	return useQuery<CollaboratorsResponse>({
		queryKey: ["pull-request-collaborators", runId],
		queryFn: !enabled
			? skipToken
			: async () =>
					CollaboratorsResponseSchema.parse(await jsonFetch(prPath(runId, "/collaborators"))),
		staleTime: 5 * 60 * 1000,
	});
}
