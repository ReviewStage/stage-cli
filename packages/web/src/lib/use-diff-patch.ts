import { type UseQueryResult, useQuery } from "@tanstack/react-query";

const DIFF_QUERY_ROOT = "diff";

export function diffPatchQueryKey(runId: string): readonly unknown[] {
	return [DIFF_QUERY_ROOT, runId];
}

/**
 * Fetches the unified patch for a run from the CLI's diff endpoint. Used by
 * both `FilesPage` (to render hunks) and `PullRequestLayout` (to count files
 * for the tab label). Sharing the queryKey lets react-query dedupe the
 * network request even though the hook is called from two places.
 */
export function useDiffPatch(runId: string): UseQueryResult<string> {
	return useQuery<string>({
		queryKey: diffPatchQueryKey(runId),
		queryFn: async () => {
			const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/diff.patch`);
			if (!res.ok) throw new Error(`GET diff.patch failed: ${res.status}`);
			return res.text();
		},
		enabled: runId !== "",
	});
}
