import { z } from "zod";
import { ghReadOrThrow, ghWriteOrThrow } from "./exec.js";
import type { GitHubRepo } from "./repo.js";

/** GitHub's per-viewer file review states on a pull request. */
export const FILE_VIEWED_STATE = {
	DISMISSED: "DISMISSED",
	UNVIEWED: "UNVIEWED",
	VIEWED: "VIEWED",
} as const;
export type FileViewedState = (typeof FILE_VIEWED_STATE)[keyof typeof FILE_VIEWED_STATE];

export interface ViewedFile {
	path: string;
	viewerViewedState: FileViewedState;
}

const VIEWED_FILES_PAGE_SIZE = 100;

const GET_PULL_REQUEST_VIEWED_FILES = `query GetPullRequestViewedFiles($owner: String!, $repo: String!, $number: Int!, $first: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      id
      files(first: $first, after: $after) {
        nodes {
          path
          viewerViewedState
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
}`;

const MARK_FILE_AS_VIEWED = `mutation MarkFileAsViewed($pullRequestId: ID!, $path: String!) {
  markFileAsViewed(input: { pullRequestId: $pullRequestId, path: $path }) {
    clientMutationId
  }
}`;

const UNMARK_FILE_AS_VIEWED = `mutation UnmarkFileAsViewed($pullRequestId: ID!, $path: String!) {
  unmarkFileAsViewed(input: { pullRequestId: $pullRequestId, path: $path }) {
    clientMutationId
  }
}`;

const GET_PULL_REQUEST_IDENTITY = `query GetPullRequestIdentity($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      id
      headRefOid
    }
  }
}`;

const GqlViewedFilePageSchema = z.object({
	nodes: z
		.array(z.object({ path: z.string(), viewerViewedState: z.enum(FILE_VIEWED_STATE) }).nullable())
		.nullable(),
	pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
});

const ViewedFilesQuerySchema = z.object({
	data: z.object({
		repository: z
			.object({
				pullRequest: z
					.object({ id: z.string(), files: GqlViewedFilePageSchema.nullable() })
					.nullable(),
			})
			.nullable(),
	}),
});

const IdentityQuerySchema = z.object({
	data: z.object({
		repository: z
			.object({
				pullRequest: z.object({ id: z.string(), headRefOid: z.string() }).nullable(),
			})
			.nullable(),
	}),
});

type ViewedFilesPullRequest = NonNullable<
	NonNullable<z.infer<typeof ViewedFilesQuerySchema>["data"]["repository"]>["pullRequest"]
>;

async function fetchViewedFilesPage(
	repoRoot: string,
	repo: GitHubRepo,
	prNumber: number,
	after: string | null,
): Promise<ViewedFilesPullRequest | null> {
	// `-f` keeps string GraphQL variables as strings; `-F` does typed coercion and is
	// only used for the Int variables.
	const args = [
		"api",
		"graphql",
		"-f",
		`query=${GET_PULL_REQUEST_VIEWED_FILES}`,
		"-f",
		`owner=${repo.owner}`,
		"-f",
		`repo=${repo.repo}`,
		"-F",
		`number=${prNumber}`,
		"-F",
		`first=${VIEWED_FILES_PAGE_SIZE}`,
	];
	if (after !== null) args.push("-f", `after=${after}`);
	const parsed = ViewedFilesQuerySchema.safeParse(JSON.parse(await ghReadOrThrow(args, repoRoot)));
	if (!parsed.success) {
		throw new Error("Unexpected response shape from GitHub viewed-files query");
	}
	return parsed.data.data.repository?.pullRequest ?? null;
}

function collectViewedFiles(pr: ViewedFilesPullRequest, into: ViewedFile[]): void {
	for (const node of pr.files?.nodes ?? []) {
		if (node) into.push(node);
	}
}

/**
 * Fetches the viewer's viewed state for all files in a pull request, paginating
 * through the full file list.
 *
 * Returns the pull request's node id alongside the file states so callers can use
 * it for subsequent mark/unmark mutations without an extra API call.
 */
export async function getViewedFiles(
	repoRoot: string,
	repo: GitHubRepo,
	prNumber: number,
): Promise<{ pullRequestNodeId: string; files: ViewedFile[] }> {
	const firstPage = await fetchViewedFilesPage(repoRoot, repo, prNumber, null);
	if (!firstPage) {
		throw new Error(`Pull request #${prNumber} not found in ${repo.owner}/${repo.repo}`);
	}

	const pullRequestNodeId = firstPage.id;
	const files: ViewedFile[] = [];
	collectViewedFiles(firstPage, files);

	let pageInfo = firstPage.files?.pageInfo;
	while (pageInfo?.hasNextPage && pageInfo.endCursor !== null) {
		const page = await fetchViewedFilesPage(repoRoot, repo, prNumber, pageInfo.endCursor);
		if (!page) {
			throw new Error(
				`Pull request #${prNumber} not found in ${repo.owner}/${repo.repo} during pagination`,
			);
		}
		collectViewedFiles(page, files);
		pageInfo = page.files?.pageInfo;
	}

	return { pullRequestNodeId, files };
}

export interface PullRequestIdentity {
	nodeId: string;
	/** The PR's live head commit, for freshness checks against a run's recorded head. */
	headRefOid: string;
}

/**
 * Resolves a pull request's GraphQL node id and live head commit — the lighter
 * lookup for mutation-only paths that don't need the full viewed-files listing.
 */
export async function getPullRequestIdentity(
	repoRoot: string,
	repo: GitHubRepo,
	prNumber: number,
): Promise<PullRequestIdentity> {
	const stdout = await ghReadOrThrow(
		[
			"api",
			"graphql",
			"-f",
			`query=${GET_PULL_REQUEST_IDENTITY}`,
			"-f",
			`owner=${repo.owner}`,
			"-f",
			`repo=${repo.repo}`,
			"-F",
			`number=${prNumber}`,
		],
		repoRoot,
	);
	const parsed = IdentityQuerySchema.safeParse(JSON.parse(stdout));
	if (!parsed.success) {
		throw new Error("Unexpected response shape from GitHub pull request identity query");
	}
	const pullRequest = parsed.data.data.repository?.pullRequest;
	if (!pullRequest) {
		throw new Error(`Pull request #${prNumber} not found in ${repo.owner}/${repo.repo}`);
	}
	return { nodeId: pullRequest.id, headRefOid: pullRequest.headRefOid };
}

const MutationEnvelopeSchema = z.object({
	data: z.object({
		markFileAsViewed: z.object({ clientMutationId: z.string().nullable() }).nullable().optional(),
		unmarkFileAsViewed: z.object({ clientMutationId: z.string().nullable() }).nullable().optional(),
	}),
});

/**
 * A successful gh exit with a null/malformed mutation payload means GitHub did
 * not perform the mutation; reject so callers log the divergence instead of
 * assuming the sync happened.
 */
function assertMutationPerformed(stdout: string, field: "markFileAsViewed" | "unmarkFileAsViewed") {
	const parsed = MutationEnvelopeSchema.safeParse(JSON.parse(stdout));
	if (!parsed.success || !parsed.data.data[field]) {
		throw new Error(`GitHub returned no ${field} confirmation`);
	}
}

/**
 * Marks a file as viewed in a pull request on GitHub. Viewed state is per-user,
 * so this acts as the `gh`-authenticated viewer.
 */
export async function markFileAsViewed(
	repoRoot: string,
	pullRequestNodeId: string,
	path: string,
): Promise<void> {
	const stdout = await ghWriteOrThrow(
		[
			"api",
			"graphql",
			"-f",
			`query=${MARK_FILE_AS_VIEWED}`,
			"-f",
			`pullRequestId=${pullRequestNodeId}`,
			"-f",
			`path=${path}`,
		],
		repoRoot,
	);
	assertMutationPerformed(stdout, "markFileAsViewed");
}

/** Unmarks a file as viewed in a pull request on GitHub. */
export async function unmarkFileAsViewed(
	repoRoot: string,
	pullRequestNodeId: string,
	path: string,
): Promise<void> {
	const stdout = await ghWriteOrThrow(
		[
			"api",
			"graphql",
			"-f",
			`query=${UNMARK_FILE_AS_VIEWED}`,
			"-f",
			`pullRequestId=${pullRequestNodeId}`,
			"-f",
			`path=${path}`,
		],
		repoRoot,
	);
	assertMutationPerformed(stdout, "unmarkFileAsViewed");
}
