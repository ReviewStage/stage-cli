import { z } from "zod";
import { ghReadOrThrow } from "./exec.js";
import type { GitHubRepo } from "./repo.js";

// Vendored from hosted Stage's `packages/github/src/pull-request-stack.ts`,
// adapted from Octokit's cached `listPullRequests` to a `gh api` read: the CLI
// fetches the repo's open PRs on demand and validates them with Zod, but the
// stack derivation itself is byte-for-byte hosted's algorithm.

/** The slice of a listed pull request the stack derivation consumes. */
export interface GitHubPullRequestListItem {
	number: number;
	title: string;
	state: "open" | "closed";
	draft: boolean;
	head: { ref: string };
	base: { ref: string };
	/**
	 * True when the head branch lives in a different repo than the base (a fork
	 * PR). Branch refs only identify a stack edge within a single repo, so fork
	 * heads must not be matched against base-repo branch names.
	 */
	isCrossRepository: boolean;
}

/** A single pull request within a detected stack, as surfaced to the reviewer. */
export interface PullRequestStackEntry {
	number: number;
	title: string;
	headRef: string;
	baseRef: string;
	isDraft: boolean;
	/** True for the pull request the stack was derived from. */
	isCurrent: boolean;
}

/**
 * Derives the stack of open pull requests connected to `currentNumber`, ordered
 * from the base of the stack (closest to the target branch) up to the tip.
 *
 * A stack edge exists when one PR's base branch is another PR's head branch and
 * that branch has exactly one dependent PR. A branch many PRs target is a
 * shared, long-lived base (main, develop, a release branch), not a stack link,
 * so it forms no edge. Because both the parent and the child of any branch are
 * therefore unique, the stack through the current PR is a linear chain that we
 * just walk. Detection is tool-agnostic — it works for Graphite, `gh`, or
 * hand-rolled branches alike — and only open PRs participate, so merged or
 * closed PRs drop out as the stack lands.
 *
 * Returns an empty array when the current PR is not open or stands alone, i.e.
 * there is no stack to navigate.
 */
export function buildPullRequestStack(
	pullRequests: GitHubPullRequestListItem[],
	currentNumber: number,
): PullRequestStackEntry[] {
	const openByNumber = new Map<number, GitHubPullRequestListItem>();
	const byHeadRef = new Map<string, GitHubPullRequestListItem>();
	const ambiguousHeadRefs = new Set<string>();
	const dependentsByBaseRef = new Map<string, GitHubPullRequestListItem[]>();

	for (const pr of pullRequests) {
		// Only open, same-repo PRs participate. A fork PR's head branch lives in
		// the fork, so its bare head.ref must not be matched against base-repo
		// branch names — otherwise a fork PR from "main" into "main" would look
		// like the parent of every PR based on "main".
		if (pr.state !== "open" || pr.isCrossRepository) continue;
		openByNumber.set(pr.number, pr);
		// A branch with two open PRs (the same head opened against different
		// bases) is an ambiguous parent — drop it from edge resolution rather
		// than guess which one a child stacks on.
		if (byHeadRef.has(pr.head.ref) || ambiguousHeadRefs.has(pr.head.ref)) {
			ambiguousHeadRefs.add(pr.head.ref);
			byHeadRef.delete(pr.head.ref);
		} else {
			byHeadRef.set(pr.head.ref, pr);
		}
		const dependents = dependentsByBaseRef.get(pr.base.ref);
		if (dependents) {
			dependents.push(pr);
		} else {
			dependentsByBaseRef.set(pr.base.ref, [pr]);
		}
	}

	const current = openByNumber.get(currentNumber);
	if (!current) return [];

	// A stack edge requires a branch with exactly one dependent PR, which keeps
	// the chain linear and precise (at the cost of not detecting branching
	// stacks). byHeadRef has already dropped ambiguous heads, so parentOf rejects
	// them for free; childOf looks up by head ref directly and must guard.
	const soleDependent = (ref: string) => {
		const dependents = dependentsByBaseRef.get(ref);
		return dependents?.length === 1 ? dependents[0] : undefined;
	};
	const parentOf = (pr: GitHubPullRequestListItem) =>
		soleDependent(pr.base.ref) === pr ? byHeadRef.get(pr.base.ref) : undefined;
	const childOf = (pr: GitHubPullRequestListItem) =>
		ambiguousHeadRefs.has(pr.head.ref) ? undefined : soleDependent(pr.head.ref);

	// Walk down to the root, then up to the tip. Re-encountering a PR we've
	// already placed means a base/head cycle (e.g. A → B and B → A) — that isn't
	// a real stack, so bail rather than surface the partial chain.
	const chain = [current];
	const seen = new Set([current.number]);
	for (let node = parentOf(current); node; node = parentOf(node)) {
		if (seen.has(node.number)) return [];
		seen.add(node.number);
		chain.unshift(node);
	}
	for (let node = childOf(current); node; node = childOf(node)) {
		if (seen.has(node.number)) return [];
		seen.add(node.number);
		chain.push(node);
	}

	if (chain.length < 2) return [];

	return chain.map((pr) => ({
		number: pr.number,
		title: pr.title,
		headRef: pr.head.ref,
		baseRef: pr.base.ref,
		isDraft: Boolean(pr.draft),
		isCurrent: pr.number === currentNumber,
	}));
}

// ─── Listing via `gh api` ─────────────────────────────────────────────────────

const RestListedPullSchema = z.object({
	number: z.number(),
	title: z.string(),
	state: z.enum(["open", "closed"]),
	draft: z.boolean().optional(),
	head: z.object({ ref: z.string(), repo: z.object({ id: z.number() }).nullable() }),
	base: z.object({ ref: z.string(), repo: z.object({ id: z.number() }).nullable() }),
});

/** `--paginate --slurp` wraps every page into one JSON array (`[[…], […]]`). */
const PaginatedPullPagesSchema = z.array(z.array(RestListedPullSchema));

function toListItem(pull: z.infer<typeof RestListedPullSchema>): GitHubPullRequestListItem {
	return {
		number: pull.number,
		title: pull.title,
		state: pull.state,
		draft: Boolean(pull.draft),
		head: { ref: pull.head.ref },
		base: { ref: pull.base.ref },
		// A fork PR's head repo differs from (or is missing relative to) the base
		// repo; a missing head repo (deleted fork) also counts as cross-repo.
		isCrossRepository: pull.head.repo?.id !== pull.base.repo?.id,
	};
}

/**
 * The stack of open PRs connected to `currentNumber`, derived on read from the
 * repo's open PR list. Only open PRs can form a stack, so the closed ones
 * hosted's cached list carries are simply never fetched. Returns [] on any gh
 * failure or unexpected shape so the header degrades to no stack.
 */
export async function getPullRequestStack(
	repoRoot: string,
	repo: GitHubRepo,
	currentNumber: number,
): Promise<PullRequestStackEntry[]> {
	try {
		const stdout = await ghReadOrThrow(
			[
				"api",
				`repos/${repo.owner}/${repo.repo}/pulls?state=open&per_page=100`,
				"--paginate",
				"--slurp",
			],
			repoRoot,
		);
		const parsed = PaginatedPullPagesSchema.safeParse(JSON.parse(stdout));
		if (!parsed.success) return [];
		return buildPullRequestStack(parsed.data.flat().map(toListItem), currentNumber);
	} catch {
		return [];
	}
}
