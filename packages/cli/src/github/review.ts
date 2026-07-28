import type { ReviewEvent } from "@stagereview/types/review";
import { z } from "zod";
import { ghOrThrow } from "./exec.js";
import type { GitHubRepo } from "./repo.js";

/**
 * GitHub's diff sides. `LEFT` is the base/deletion side, `RIGHT` the head/addition
 * side; they map onto the local `DIFF_SIDE` (deletions/additions) in the review layer.
 */
export const GITHUB_DIFF_SIDE = {
	LEFT: "LEFT",
	RIGHT: "RIGHT",
} as const;
export type GitHubDiffSide = (typeof GITHUB_DIFF_SIDE)[keyof typeof GITHUB_DIFF_SIDE];

// ─── Read: the PR's review state in one paginated query ─────────────────────────

// A single GraphQL query gives everything we render: the PR node id (needed by the
// write mutations), the viewer's pending-review node id, and every review thread
// with its comments. Each comment's `pullRequestReview.state` distinguishes a
// PENDING (draft, viewer-only) comment from a submitted one — no REST list or
// local mirror required.
const REVIEW_QUERY = `query GetReview($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      id
      viewerDidAuthor
      headRefOid
      reviews(states: PENDING, first: 1) { nodes { id body } }
      reviewThreads(first: 50, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          path
          line
          startLine
          diffSide
          startDiffSide
          comments(first: 100) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              url
              body
              bodyHTML
              createdAt
              author { login avatarUrl }
              pullRequestReview { state }
            }
          }
        }
      }
    }
  }
}`;

const REVIEW_THREAD_COMMENTS_QUERY = `query GetReviewThreadComments($threadId: ID!, $cursor: String) {
  node(id: $threadId) {
    ... on PullRequestReviewThread {
      comments(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          url
          body
          bodyHTML
          createdAt
          author { login avatarUrl }
          pullRequestReview { state }
        }
      }
    }
  }
}`;

const GqlActorSchema = z.object({ login: z.string(), avatarUrl: z.string() }).nullable();

const GqlReviewCommentSchema = z.object({
	id: z.string(),
	url: z.string(),
	body: z.string(),
	bodyHTML: z.string(),
	createdAt: z.string(),
	author: GqlActorSchema,
	pullRequestReview: z.object({ state: z.string() }).nullable(),
});

const GqlPageInfoSchema = z.object({
	hasNextPage: z.boolean(),
	endCursor: z.string().nullable(),
});

const GqlReviewCommentsPageSchema = z.object({
	pageInfo: GqlPageInfoSchema,
	nodes: z.array(GqlReviewCommentSchema),
});

const GqlReviewThreadSchema = z.object({
	id: z.string(),
	isResolved: z.boolean(),
	path: z.string(),
	line: z.number().nullable(),
	startLine: z.number().nullable(),
	diffSide: z.enum(GITHUB_DIFF_SIDE),
	startDiffSide: z.enum(GITHUB_DIFF_SIDE).nullable(),
	comments: GqlReviewCommentsPageSchema,
});

const ReviewQuerySchema = z.object({
	data: z.object({
		repository: z
			.object({
				pullRequest: z
					.object({
						id: z.string(),
						viewerDidAuthor: z.boolean(),
						headRefOid: z.string(),
						reviews: z.object({
							nodes: z.array(z.object({ id: z.string(), body: z.string() })),
						}),
						reviewThreads: z.object({
							pageInfo: GqlPageInfoSchema,
							nodes: z.array(GqlReviewThreadSchema),
						}),
					})
					.nullable(),
			})
			.nullable(),
	}),
});

const ReviewThreadCommentsQuerySchema = z.object({
	data: z.object({
		node: z
			.object({
				comments: GqlReviewCommentsPageSchema,
			})
			.nullable(),
	}),
});

/** A comment within a review thread, tagged with whether it's a draft (pending) or published. */
export interface ReviewComment {
	nodeId: string;
	htmlUrl: string;
	body: string;
	/** GitHub's server-rendered HTML (resolves @mentions, #refs, emoji). */
	bodyHtml: string;
	createdAt: string;
	authorLogin: string;
	authorAvatarUrl: string;
	/** Pending = part of the viewer's unsubmitted review (only they see it). */
	isPending: boolean;
}

/** A line-anchored review thread on the PR, with its comments oldest-first. */
export interface ReviewThread {
	threadNodeId: string;
	isResolved: boolean;
	path: string;
	line: number;
	startLine: number | null;
	side: GitHubDiffSide;
	startSide: GitHubDiffSide | null;
	comments: ReviewComment[];
}

export interface GitHubReview {
	/** GraphQL node id of the PR, required by the write mutations. */
	pullRequestNodeId: string;
	/** True when the viewer opened the PR (GitHub forbids approving your own PR). */
	viewerDidAuthor: boolean;
	/** The PR's current head commit — comments anchor to this commit's diff. */
	headRefOid: string;
	/** The viewer's open pending review, or null when they have none. */
	pendingReviewNodeId: string | null;
	/** Existing summary text on the viewer's open pending review. */
	pendingReviewBody: string;
	/** Viewer's pending (draft) comments across all threads, including anchorless ones. */
	pendingCommentCount: number;
	pendingComments: PendingReviewComment[];
	threads: ReviewThread[];
}

export interface PendingReviewComment {
	id: string;
	filePath: string;
	line: number | null;
	body: string;
}

const PENDING_STATE = "PENDING";
const THREAD_COMMENT_LOAD_CONCURRENCY = 5;

/**
 * The PR's review threads (pending + submitted) as the viewer sees them, plus the
 * ids the write mutations need. Threads with no anchorable line (outdated or
 * whole-file) are dropped — the review UI is line-anchored.
 */
export async function getReview(
	repoRoot: string,
	repo: GitHubRepo,
	prNumber: number,
): Promise<GitHubReview> {
	let pullRequestNodeId = "";
	let viewerDidAuthor = false;
	let headRefOid = "";
	let pendingReviewNodeId: string | null = null;
	let pendingReviewBody = "";
	let pendingCommentCount = 0;
	const pendingComments: PendingReviewComment[] = [];
	const threads: ReviewThread[] = [];
	let cursor: string | null = null;

	do {
		// `-f` keeps string GraphQL variables as strings; `-F` does typed coercion, which
		// would mangle a repo/owner literally named `123`, `true`, or `null` into the wrong
		// GraphQL type. Only `number` (Int!) uses `-F`.
		const args = [
			"api",
			"graphql",
			"-f",
			`query=${REVIEW_QUERY}`,
			"-f",
			`owner=${repo.owner}`,
			"-f",
			`repo=${repo.repo}`,
			"-F",
			`number=${prNumber}`,
		];
		if (cursor !== null) args.push("-f", `cursor=${cursor}`);
		const parsed = ReviewQuerySchema.safeParse(JSON.parse(await ghOrThrow(args, repoRoot)));
		if (!parsed.success) throw new Error("Unexpected response shape from GitHub review query");
		const pr = parsed.data.data.repository?.pullRequest;
		if (!pr) break;
		pullRequestNodeId = pr.id;
		viewerDidAuthor = pr.viewerDidAuthor;
		headRefOid = pr.headRefOid;
		pendingReviewNodeId = pr.reviews.nodes[0]?.id ?? null;
		pendingReviewBody = pr.reviews.nodes[0]?.body ?? "";

		const nodesWithComments = await loadThreadCommentsInBatches(repoRoot, pr.reviewThreads.nodes);
		for (const { node, comments } of nodesWithComments) {
			// Count pending (draft) comments across every thread, including outdated/whole-file
			// ones dropped below — so the tray count and the empty-review check don't undercount.
			for (const c of comments) {
				if (c.pullRequestReview?.state !== PENDING_STATE) continue;
				pendingCommentCount++;
				pendingComments.push({
					id: c.id,
					filePath: node.path,
					line: node.line,
					body: c.body,
				});
			}
			const root = comments[0];
			if (!root || node.line === null) continue;
			threads.push({
				threadNodeId: node.id,
				isResolved: node.isResolved,
				path: node.path,
				line: node.line,
				startLine: node.startLine,
				side: node.diffSide,
				startSide: node.startDiffSide,
				comments: comments.map(toReviewComment),
			});
		}
		cursor = nextCursor(pr.reviewThreads.pageInfo);
	} while (cursor !== null);

	// No `pullRequest` in the response (stale/unknown PR number, or repo no longer
	// resolves) — treat as unavailable rather than handing back an empty node id that
	// later write mutations would post against.
	if (pullRequestNodeId === "") throw new Error("Pull request not found on GitHub");

	return {
		pullRequestNodeId,
		viewerDidAuthor,
		headRefOid,
		pendingReviewNodeId,
		pendingReviewBody,
		pendingCommentCount,
		pendingComments,
		threads,
	};
}

async function loadThreadCommentsInBatches(
	repoRoot: string,
	nodes: z.infer<typeof GqlReviewThreadSchema>[],
): Promise<
	{
		node: z.infer<typeof GqlReviewThreadSchema>;
		comments: z.infer<typeof GqlReviewCommentSchema>[];
	}[]
> {
	const loaded: {
		node: z.infer<typeof GqlReviewThreadSchema>;
		comments: z.infer<typeof GqlReviewCommentSchema>[];
	}[] = [];
	for (let start = 0; start < nodes.length; start += THREAD_COMMENT_LOAD_CONCURRENCY) {
		const batch = nodes.slice(start, start + THREAD_COMMENT_LOAD_CONCURRENCY);
		loaded.push(
			...(await Promise.all(
				batch.map(async (node) => ({
					node,
					comments: await loadReviewThreadComments(repoRoot, node.id, node.comments),
				})),
			)),
		);
	}
	return loaded;
}

async function loadReviewThreadComments(
	repoRoot: string,
	threadNodeId: string,
	firstPage: z.infer<typeof GqlReviewCommentsPageSchema>,
): Promise<z.infer<typeof GqlReviewCommentSchema>[]> {
	const comments = [...firstPage.nodes];
	let cursor = nextCursor(firstPage.pageInfo);
	while (cursor !== null) {
		try {
			const args = [
				"api",
				"graphql",
				"-f",
				`query=${REVIEW_THREAD_COMMENTS_QUERY}`,
				"-f",
				`threadId=${threadNodeId}`,
				"-f",
				`cursor=${cursor}`,
			];
			const parsed = ReviewThreadCommentsQuerySchema.safeParse(
				JSON.parse(await ghOrThrow(args, repoRoot)),
			);
			if (!parsed.success || parsed.data.data.node === null) {
				throw new Error("Unexpected response shape from GitHub review comments query");
			}
			const page = parsed.data.data.node.comments;
			comments.push(...page.nodes);
			cursor = nextCursor(page.pageInfo);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			process.stderr.write(
				`Failed to load all comments for GitHub review thread ${threadNodeId}: ${message}\n`,
			);
			break;
		}
	}
	return comments;
}

function nextCursor(pageInfo: z.infer<typeof GqlPageInfoSchema>): string | null {
	if (!pageInfo.hasNextPage) return null;
	if (pageInfo.endCursor === null) {
		throw new Error("GitHub returned a paginated review connection without a cursor");
	}
	return pageInfo.endCursor;
}

function toReviewComment(c: z.infer<typeof GqlReviewCommentSchema>): ReviewComment {
	return {
		nodeId: c.id,
		htmlUrl: c.url,
		body: c.body,
		bodyHtml: c.bodyHTML,
		createdAt: c.createdAt,
		authorLogin: c.author?.login ?? "ghost",
		authorAvatarUrl: c.author?.avatarUrl ?? "",
		isPending: c.pullRequestReview?.state === PENDING_STATE,
	};
}

// ─── Write: pending-review lifecycle ────────────────────────────────────────────

const CREATE_PENDING_REVIEW = `mutation CreatePendingReview($pullRequestId: ID!) {
  addPullRequestReview(input: { pullRequestId: $pullRequestId }) {
    pullRequestReview { id }
  }
}`;

const ADD_REVIEW_THREAD = `mutation AddReviewThread($pullRequestId: ID!, $reviewId: ID!, $path: String!, $body: String!, $line: Int!, $startLine: Int, $side: DiffSide!, $startSide: DiffSide) {
  addPullRequestReviewThread(input: { pullRequestId: $pullRequestId, pullRequestReviewId: $reviewId, path: $path, body: $body, line: $line, startLine: $startLine, side: $side, startSide: $startSide }) {
    thread { id comments(first: 1) { nodes { id } } }
  }
}`;

const ADD_REVIEW_REPLY = `mutation AddReviewReply($threadId: ID!, $reviewId: ID, $body: String!) {
  addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, pullRequestReviewId: $reviewId, body: $body }) {
    comment { id }
  }
}`;

const UPDATE_REVIEW_COMMENT = `mutation UpdateReviewComment($commentId: ID!, $body: String!) {
  updatePullRequestReviewComment(input: { pullRequestReviewCommentId: $commentId, body: $body }) {
    pullRequestReviewComment { id }
  }
}`;

const DELETE_REVIEW_COMMENT = `mutation DeleteReviewComment($commentId: ID!) {
  deletePullRequestReviewComment(input: { id: $commentId }) {
    pullRequestReviewComment { id }
  }
}`;

const SUBMIT_REVIEW = `mutation SubmitReview($pullRequestId: ID!, $reviewId: ID!, $event: PullRequestReviewEvent!, $body: String) {
  submitPullRequestReview(input: { pullRequestId: $pullRequestId, pullRequestReviewId: $reviewId, event: $event, body: $body }) {
    pullRequestReview { id }
  }
}`;

const DISCARD_REVIEW = `mutation DiscardReview($reviewId: ID!) {
  deletePullRequestReview(input: { pullRequestReviewId: $reviewId }) {
    pullRequestReview { id }
  }
}`;

const RESOLVE_THREAD = `mutation ResolveThread($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) { thread { id } }
}`;

const UNRESOLVE_THREAD = `mutation UnresolveThread($threadId: ID!) {
  unresolveReviewThread(input: { threadId: $threadId }) { thread { id } }
}`;

function gqlArgs(query: string, fields: Record<string, string | number | null>): string[] {
	const args = ["api", "graphql", "-f", `query=${query}`];
	for (const [key, value] of Object.entries(fields)) {
		// Omit null fields so GraphQL applies its own null default (e.g. single-line
		// comments send no startLine/startSide).
		if (value === null) continue;
		// `-f` for strings, `-F` for the numeric line fields (typed JSON values).
		args.push(typeof value === "number" ? "-F" : "-f", `${key}=${value}`);
	}
	return args;
}

const CreatedReviewSchema = z.object({
	data: z.object({
		addPullRequestReview: z.object({ pullRequestReview: z.object({ id: z.string() }) }),
	}),
});

/** Open an empty pending review on the PR, returning its node id. */
export async function createPendingReview(
	repoRoot: string,
	pullRequestNodeId: string,
): Promise<string> {
	const stdout = await ghOrThrow(
		gqlArgs(CREATE_PENDING_REVIEW, { pullRequestId: pullRequestNodeId }),
		repoRoot,
	);
	return CreatedReviewSchema.parse(JSON.parse(stdout)).data.addPullRequestReview.pullRequestReview
		.id;
}

export interface AddReviewThreadInput {
	pullRequestNodeId: string;
	reviewNodeId: string;
	path: string;
	body: string;
	line: number;
	side: GitHubDiffSide;
	startLine: number | null;
	startSide: GitHubDiffSide | null;
}

const AddedThreadSchema = z.object({
	data: z.object({
		addPullRequestReviewThread: z.object({
			thread: z.object({
				id: z.string(),
				comments: z.object({ nodes: z.array(z.object({ id: z.string() })) }),
			}),
		}),
	}),
});

export interface AddedReviewThread {
	threadNodeId: string;
	rootCommentNodeId: string;
}

/** Add a line-anchored comment (a new thread) to a pending review. */
export async function addReviewThread(
	repoRoot: string,
	input: AddReviewThreadInput,
): Promise<AddedReviewThread> {
	const stdout = await ghOrThrow(
		gqlArgs(ADD_REVIEW_THREAD, {
			pullRequestId: input.pullRequestNodeId,
			reviewId: input.reviewNodeId,
			path: input.path,
			body: input.body,
			line: input.line,
			startLine: input.startLine,
			side: input.side,
			startSide: input.startSide,
		}),
		repoRoot,
	);
	const thread = AddedThreadSchema.parse(JSON.parse(stdout)).data.addPullRequestReviewThread.thread;
	const root = thread.comments.nodes[0];
	if (!root) throw new Error("GitHub returned a review thread without its root comment");
	return { threadNodeId: thread.id, rootCommentNodeId: root.id };
}

/** Reply to an existing thread, attaching the reply to a pending review when one is open. */
export async function addReviewReply(
	repoRoot: string,
	threadNodeId: string,
	body: string,
	reviewNodeId: string | null,
): Promise<void> {
	await ghOrThrow(
		gqlArgs(ADD_REVIEW_REPLY, { threadId: threadNodeId, reviewId: reviewNodeId, body }),
		repoRoot,
	);
}

/** Edit a review comment by node id (works for pending and submitted comments). */
export async function updateReviewComment(
	repoRoot: string,
	commentNodeId: string,
	body: string,
): Promise<void> {
	await ghOrThrow(gqlArgs(UPDATE_REVIEW_COMMENT, { commentId: commentNodeId, body }), repoRoot);
}

/** Delete a review comment by node id (used for pending comments). */
export async function deleteReviewComment(repoRoot: string, commentNodeId: string): Promise<void> {
	await ghOrThrow(gqlArgs(DELETE_REVIEW_COMMENT, { commentId: commentNodeId }), repoRoot);
}

/** Submit the pending review with the chosen event (Comment / Approve / Request changes). */
export async function submitReview(
	repoRoot: string,
	pullRequestNodeId: string,
	reviewNodeId: string,
	event: ReviewEvent,
	body: string,
): Promise<void> {
	await ghOrThrow(
		gqlArgs(SUBMIT_REVIEW, {
			pullRequestId: pullRequestNodeId,
			reviewId: reviewNodeId,
			event,
			body,
		}),
		repoRoot,
	);
}

/** Throw away the pending review and all its draft comments. */
export async function discardReview(repoRoot: string, reviewNodeId: string): Promise<void> {
	await ghOrThrow(gqlArgs(DISCARD_REVIEW, { reviewId: reviewNodeId }), repoRoot);
}

/** Resolve or reopen a review thread by its node id. */
export async function setThreadResolved(
	repoRoot: string,
	threadNodeId: string,
	resolved: boolean,
): Promise<void> {
	await ghOrThrow(
		gqlArgs(resolved ? RESOLVE_THREAD : UNRESOLVE_THREAD, { threadId: threadNodeId }),
		repoRoot,
	);
}
