import { describe, expect, it } from "vitest";
import {
	buildPullRequestStack,
	type GitHubPullRequestListItem,
} from "../github/pull-request-stack.js";

// The pr() helper builds the CLI's narrowed list item (only the fields the
// stack derivation consumes).

function pr(
	number: number,
	headRef: string,
	baseRef: string,
	overrides: {
		state?: "open" | "closed";
		draft?: boolean;
		title?: string;
		crossRepo?: boolean;
	} = {},
): GitHubPullRequestListItem {
	return {
		number,
		title: overrides.title ?? `PR ${number}`,
		state: overrides.state ?? "open",
		draft: overrides.draft ?? false,
		head: { ref: headRef },
		base: { ref: baseRef },
		isCrossRepository: overrides.crossRepo ?? false,
	};
}

// A three-PR linear stack: #1 → #2 → #3, each based on the previous head branch.
const linearStack: [
	GitHubPullRequestListItem,
	GitHubPullRequestListItem,
	GitHubPullRequestListItem,
] = [pr(1, "feat-1", "main"), pr(2, "feat-2", "feat-1"), pr(3, "feat-3", "feat-2")];

describe("buildPullRequestStack", () => {
	it("orders a linear stack base → tip regardless of input order", () => {
		const shuffled = [linearStack[2], linearStack[0], linearStack[1]];
		const stack = buildPullRequestStack(shuffled, 2);

		expect(stack.map((e) => e.number)).toEqual([1, 2, 3]);
		expect(stack.map((e) => e.isCurrent)).toEqual([false, true, false]);
	});

	it("returns the same ordered stack from any member's perspective", () => {
		expect(buildPullRequestStack(linearStack, 1).map((e) => e.number)).toEqual([1, 2, 3]);
		expect(buildPullRequestStack(linearStack, 3).map((e) => e.number)).toEqual([1, 2, 3]);
		expect(buildPullRequestStack(linearStack, 1).find((e) => e.isCurrent)?.number).toBe(1);
		expect(buildPullRequestStack(linearStack, 3).find((e) => e.isCurrent)?.number).toBe(3);
	});

	it("returns an empty stack for a standalone PR", () => {
		const prs = [pr(5, "feat-5", "main"), pr(6, "feat-6", "main")];
		expect(buildPullRequestStack(prs, 5)).toEqual([]);
	});

	it("does not form a stack across a branch with multiple dependents", () => {
		// #2 and #3 both branch off #1's head — ambiguous between a branching
		// stack and a shared base, so we don't show a (likely spurious) stack.
		const prs = [pr(1, "f1", "main"), pr(2, "f2", "f1"), pr(3, "f3", "f1")];
		expect(buildPullRequestStack(prs, 1)).toEqual([]);
		expect(buildPullRequestStack(prs, 2)).toEqual([]);
	});

	it("ignores long-lived shared base branches (e.g. develop → main)", () => {
		// A standing develop → main sync PR must not become the parent of every
		// feature PR based on develop.
		const prs = [pr(10, "develop", "main"), pr(1, "feat-1", "develop"), pr(2, "feat-2", "develop")];
		expect(buildPullRequestStack(prs, 1)).toEqual([]);
		expect(buildPullRequestStack(prs, 10)).toEqual([]);
	});

	it("excludes closed PRs from the stack", () => {
		const prs = [
			pr(1, "feat-1", "main", { state: "closed" }),
			pr(2, "feat-2", "feat-1"),
			pr(3, "feat-3", "feat-2"),
		];
		const stack = buildPullRequestStack(prs, 2);

		expect(stack.map((e) => e.number)).toEqual([2, 3]);
	});

	it("excludes fork PRs whose head ref collides with a base branch", () => {
		// A fork PR from "main" into "main" must not become the parent of in-repo
		// PRs based on "main", nor have a stack of its own.
		const prs = [
			pr(1, "feat-1", "main"),
			pr(2, "feat-2", "feat-1"),
			pr(99, "main", "main", { crossRepo: true }),
		];
		expect(buildPullRequestStack(prs, 1).map((e) => e.number)).toEqual([1, 2]);
		expect(buildPullRequestStack(prs, 99)).toEqual([]);
	});

	it("ignores a head branch shared by two open PRs (ambiguous parent)", () => {
		// feat-a is the head of both #1 and #2 (opened against different bases),
		// so #3 (based on feat-a) has no unambiguous parent to stack on.
		const prs = [pr(1, "feat-a", "main"), pr(2, "feat-a", "develop"), pr(3, "feat-b", "feat-a")];
		expect(buildPullRequestStack(prs, 3)).toEqual([]);
		expect(buildPullRequestStack(prs, 1)).toEqual([]);
	});

	it("returns an empty stack when the current PR is not open", () => {
		const prs = [pr(1, "feat-1", "main", { state: "closed" }), pr(2, "feat-2", "feat-1")];
		expect(buildPullRequestStack(prs, 1)).toEqual([]);
	});

	it("returns an empty stack for a base/head cycle", () => {
		// #1 is based on #2's branch and #2 on #1's — mutually based, not a stack.
		const prs = [pr(1, "A", "B"), pr(2, "B", "A")];
		expect(buildPullRequestStack(prs, 1)).toEqual([]);
		expect(buildPullRequestStack(prs, 2)).toEqual([]);
	});

	it("maps display fields and draft state", () => {
		const prs = [
			pr(1, "feat-1", "main", { title: "Base work" }),
			pr(2, "feat-2", "feat-1", { title: "Build on it", draft: true }),
		];
		const stack = buildPullRequestStack(prs, 1);

		expect(stack).toEqual([
			{
				number: 1,
				title: "Base work",
				headRef: "feat-1",
				baseRef: "main",
				isDraft: false,
				isCurrent: true,
			},
			{
				number: 2,
				title: "Build on it",
				headRef: "feat-2",
				baseRef: "feat-1",
				isDraft: true,
				isCurrent: false,
			},
		]);
	});

	it("returns an empty stack when the PR is absent from the list", () => {
		expect(buildPullRequestStack(linearStack, 99)).toEqual([]);
	});
});
