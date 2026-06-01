import {
	type GitHubPullRequest,
	PULL_REQUEST_REVIEW_STATUS,
	type PullRequestReviewSummary,
} from "@stagereview/types/pull-request";
import { createContext, type ReactNode, use, useMemo } from "react";
import { usePullRequestReviews } from "@/lib/use-pull-request";

interface PullRequestContextValue {
	runId: string;
	owner: string;
	repo: string;
	number: number;
	headSha: string;
	pullRequest: GitHubPullRequest;
	reviews: PullRequestReviewSummary | null;
}

const PullRequestContext = createContext<PullRequestContextValue | null>(null);

// Stable reference for the settled-but-empty case, so the useMemo below doesn't
// see a new object every render (which would re-render all context consumers).
const EMPTY_REVIEW_SUMMARY: PullRequestReviewSummary = {
	status: PULL_REQUEST_REVIEW_STATUS.NO_REVIEWS,
	reviewers: [],
};

/** Parse `owner`/`repo` from a PR html_url (`https://github.com/owner/repo/pull/123`). */
function parseOwnerRepo(htmlUrl: string): { owner: string; repo: string } {
	const match = htmlUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\//);
	return { owner: match?.[1] ?? "", repo: match?.[2] ?? "" };
}

export function PullRequestProvider({
	runId,
	pullRequest,
	children,
}: {
	runId: string;
	pullRequest: GitHubPullRequest;
	children: ReactNode;
}) {
	const { data: reviewsData, isPending: reviewsPending } = usePullRequestReviews(
		runId,
		pullRequest.number,
	);
	const { owner, repo } = parseOwnerRepo(pullRequest.html_url);

	// `null` means "still loading" to consumers (Reviewers shows a spinner). Once the
	// query settles — even if gh failed and returned no summary — fall back to an empty
	// summary so the UI stops spinning and shows "no reviewers" instead.
	const reviews: PullRequestReviewSummary | null = reviewsPending
		? null
		: (reviewsData?.reviews ?? EMPTY_REVIEW_SUMMARY);

	const value = useMemo<PullRequestContextValue>(
		() => ({
			runId,
			owner,
			repo,
			number: pullRequest.number,
			headSha: pullRequest.head.sha,
			pullRequest,
			reviews,
		}),
		[runId, owner, repo, pullRequest, reviews],
	);

	return <PullRequestContext value={value}>{children}</PullRequestContext>;
}

export function usePullRequestContext(): PullRequestContextValue {
	const context = use(PullRequestContext);
	if (!context) {
		throw new Error("usePullRequestContext must be used within a PullRequestProvider");
	}
	return context;
}
