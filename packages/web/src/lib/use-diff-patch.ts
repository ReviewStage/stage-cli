import { type UseQueryResult, useQuery } from "@tanstack/react-query";

const DIFF_QUERY_ROOT = "diff";

export function diffPatchQueryKey(runId: string): readonly unknown[] {
	return [DIFF_QUERY_ROOT, runId];
}

// Shared queryKey lets react-query dedupe the patch fetch when the same hook
// is mounted from more than one component for the same run.
export function useDiffPatch(runId: string): UseQueryResult<string> {
	return useQuery<string>({
		queryKey: diffPatchQueryKey(runId),
		queryFn: async () => {
			const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/diff.patch`);
			if (!res.ok) throw new Error(`GET diff.patch failed: ${res.status}`);
			return res.text();
		},
		enabled: runId !== "",
		staleTime: Number.POSITIVE_INFINITY,
	});
}
