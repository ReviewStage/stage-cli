import {
	type ResolvedScope,
	type ResolveScopeOptions,
	readRepoContext,
	resolveCommittedComparison,
	resolveScope,
} from "./git.js";
import { parseGitHubRepo, parsePullRequestNumber, resolvePullRequestRefs } from "./github/index.js";

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

/**
 * Resolve just the PR number from a `--pr` reference, without fetching the PR's
 * commits or computing a scope. Used when the diff scope comes from elsewhere
 * (a complete chapters file carries its own scope) but the run still needs to
 * record which PR it targets so the UI resolves the right one.
 */
export function pullRequestNumberFromRef(pr: string): number {
	const { originUrl } = readRepoContext();
	const repo = parseGitHubRepo(originUrl);
	if (!repo) {
		throw new Error(
			"--pr requires a github.com origin remote, which the current repository doesn't have.",
		);
	}
	return parsePullRequestNumber(pr, repo);
}
