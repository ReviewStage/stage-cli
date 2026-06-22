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

/** The three events a review can be submitted with, mirroring GitHub's own model. */
export const REVIEW_EVENT = {
	COMMENT: "COMMENT",
	APPROVE: "APPROVE",
	REQUEST_CHANGES: "REQUEST_CHANGES",
} as const;
export type ReviewEvent = (typeof REVIEW_EVENT)[keyof typeof REVIEW_EVENT];

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
      reviews(states: PENDING, first: 1) { nodes { id } }
      reviewThreads(first: 50, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          comments(first: 100) {
            nodes {
              databaseId
              id
              url
              path
              body
              bodyHTML
              createdAt
              line
              startLine
              diffSide
              startDiffSide
              author { login avatarUrl }
              pullRequestReview { state }
            }
          }
        }
      }
    }
  }
}`;

const GqlActorSchema = z.object({ login: z.string(), avatarUrl: z.string() }).nullable();

const GqlReviewCommentSchema = z.object({
	databaseId: z.number().nullable(),
	id: z.string(),
	url: z.string(),
	path: z.string(),
	body: z.string(),
	bodyHTML: z.string(),
	createdAt: z.string(),
	line: z.number().nullable(),
	startLine: z.number().nullable(),
	diffSide: z.enum(GITHUB_DIFF_SIDE).nullable(),
	startDiffSide: z.enum(GITHUB_DIFF_SIDE).nullable(),
	author: GqlActorSchema,
	pullRequestReview: z.object({ state: z.string() }).nullable(),
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
						reviews: z.object({ nodes: z.array(z.object({ id: z.string() })) }),
						reviewThreads: z.object({
							pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
							nodes: z.array(
								z.object({
									id: z.string(),
									isResolved: z.boolean(),
									comments: z.object({ nodes: z.array(GqlReviewCommentSchema) }),
								}),
							),
						}),
					})
					.nullable(),
			})
			.nullable(),
	}),
});

/** A comment within a review thread, tagged with whether it's a draft (pending) or published. */
export interface ReviewComment {
	databaseId: number | null;
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
	line: number | null;
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
	threads: ReviewThread[];
}

const PENDING_STATE = "PENDING";

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
	const threads: ReviewThread[] = [];
	let cursor: string | null = null;

	do {
		const args = [
			"api",
			"graphql",
			"-f",
			`query=${REVIEW_QUERY}`,
			"-F",
			`owner=${repo.owner}`,
			"-F",
			`repo=${repo.repo}`,
			"-F",
			`number=${prNumber}`,
		];
		if (cursor !== null) args.push("-F", `cursor=${cursor}`);
		const parsed = ReviewQuerySchema.safeParse(JSON.parse(await ghOrThrow(args, repoRoot)));
		if (!parsed.success) throw new Error("Unexpected response shape from GitHub review query");
		const pr = parsed.data.data.repository?.pullRequest;
		if (!pr) break;
		pullRequestNodeId = pr.id;
		viewerDidAuthor = pr.viewerDidAuthor;
		headRefOid = pr.headRefOid;
		pendingReviewNodeId = pr.reviews.nodes[0]?.id ?? null;

		for (const node of pr.reviewThreads.nodes) {
			const root = node.comments.nodes[0];
			if (!root || root.line === null) continue;
			threads.push({
				threadNodeId: node.id,
				isResolved: node.isResolved,
				path: root.path,
				line: root.line,
				startLine: root.startLine,
				side: root.diffSide ?? GITHUB_DIFF_SIDE.RIGHT,
				startSide: root.startDiffSide,
				comments: node.comments.nodes.map(toReviewComment),
			});
		}
		cursor = pr.reviewThreads.pageInfo.hasNextPage ? pr.reviewThreads.pageInfo.endCursor : null;
	} while (cursor !== null);

	// No `pullRequest` in the response (stale/unknown PR number, or repo no longer
	// resolves) — treat as unavailable rather than handing back an empty node id that
	// later write mutations would post against.
	if (pullRequestNodeId === "") throw new Error("Pull request not found on GitHub");

	return { pullRequestNodeId, viewerDidAuthor, headRefOid, pendingReviewNodeId, threads };
}

function toReviewComment(c: z.infer<typeof GqlReviewCommentSchema>): ReviewComment {
	return {
		databaseId: c.databaseId,
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
    thread { id }
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
		addPullRequestReviewThread: z.object({ thread: z.object({ id: z.string() }) }),
	}),
});

/** Add a line-anchored comment (a new thread) to a pending review, returning the thread's node id. */
export async function addReviewThread(
	repoRoot: string,
	input: AddReviewThreadInput,
): Promise<string> {
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
	return AddedThreadSchema.parse(JSON.parse(stdout)).data.addPullRequestReviewThread.thread.id;
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
			body: body.length > 0 ? body : null,
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
