import {
	type ResolvedScope,
	type ResolveScopeOptions,
	readRepoContext,
	resolveCommittedComparison,
	resolveScope,
} from "./git.js";
import { resolvePullRequestRefs } from "./github/index.js";

/**
 * Everything needed to scope a diff from the command line: the local-ref modes
 * understood by {@link resolveScope}, plus an optional GitHub PR reference that
 * supersedes them.
 */
export interface DiffScopeOptions extends ResolveScopeOptions {
	/** A PR number or github.com PR URL to review instead of a local-ref diff. */
	pr?: string;
}

export interface ResolvedDiffScope extends ResolvedScope {
	/** The reviewed PR's number, or null when the scope came from local refs. */
	prNumber: number | null;
}

/**
 * Resolve a diff scope for `prep`/`show`. A `--pr` reference resolves the
 * base/head from the PR itself (fetching its commits locally); otherwise the
 * scope comes from the local-ref heuristics in {@link resolveScope}.
 */
export async function resolveDiffScope(options: DiffScopeOptions): Promise<ResolvedDiffScope> {
	if (options.pr !== undefined) {
		const { root, originUrl } = readRepoContext();
		const { number, baseSha, headSha } = await resolvePullRequestRefs(root, originUrl, options.pr);
		return { ...resolveCommittedComparison(baseSha, headSha), prNumber: number };
	}
	return { ...resolveScope(options), prNumber: null };
}
