import type { GitHubPullRequest, PullRequestReviewSummary } from "@stagereview/types/pull-request";
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
	const { data: reviewsData } = usePullRequestReviews(runId, pullRequest.number);
	const { owner, repo } = parseOwnerRepo(pullRequest.html_url);

	const value = useMemo<PullRequestContextValue>(
		() => ({
			runId,
			owner,
			repo,
			number: pullRequest.number,
			headSha: pullRequest.head.sha,
			pullRequest,
			reviews: reviewsData?.reviews ?? null,
		}),
		[runId, owner, repo, pullRequest, reviewsData],
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
