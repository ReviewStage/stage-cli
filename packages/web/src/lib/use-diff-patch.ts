import type { DiffResponse } from "@stage-cli/types/diff";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";

const DIFF_QUERY_ROOT = "diff";

export function diffPatchQueryKey(runId: string): readonly unknown[] {
	return [DIFF_QUERY_ROOT, runId];
}

export function useDiffPatch(runId: string): UseQueryResult<DiffResponse> {
	return useQuery<DiffResponse>({
		queryKey: diffPatchQueryKey(runId),
		queryFn: async () => {
			const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/diff.patch`);
			if (!res.ok) throw new Error(`GET diff.patch failed: ${res.status}`);
			return res.json();
		},
		enabled: runId !== "",
		staleTime: Number.POSITIVE_INFINITY,
	});
}
