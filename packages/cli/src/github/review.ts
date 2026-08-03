import type { ReviewEvent } from "@stagereview/types/review";
import { z } from "zod";
import { ghReadOrThrow, ghWriteOrThrow } from "./exec.js";
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
const REVIEW_THREAD_PAGE_SIZE = 10;
const EMBEDDED_COMMENT_PAGE_SIZE = 1;
const THREAD_COMMENT_PAGE_SIZE = 10;
const REVIEW_QUERY = `query GetReview($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
  viewer { login }
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      id
      state
      viewerDidAuthor
      headRefOid
      baseRefOid
      reviews(states: PENDING, first: 1) { nodes { id body commit { oid } } }
	  reviewThreads(first: ${REVIEW_THREAD_PAGE_SIZE}, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          viewerCanResolve
          viewerCanUnresolve
		  viewerCanReply
          path
          line
          startLine
          diffSide
          startDiffSide
		  comments(first: ${EMBEDDED_COMMENT_PAGE_SIZE}) {
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

const REVIEW_IDENTITY_QUERY = `query GetReviewIdentity($owner: String!, $repo: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      id
      state
      viewerDidAuthor
      headRefOid
      baseRefOid
      reviews(states: PENDING, first: 1) { nodes { id body commit { oid } } }
    }
  }
}`;

const REVIEW_THREAD_COMMENTS_QUERY = `query GetReviewThreadComments($threadId: ID!, $cursor: String) {
  node(id: $threadId) {
    ... on PullRequestReviewThread {
	  comments(first: ${THREAD_COMMENT_PAGE_SIZE}, after: $cursor) {
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

const PROMOTION_THREAD_QUERY = `query GetPromotionThread($threadId: ID!) {
  node(id: $threadId) {
    ... on PullRequestReviewThread {
	  pullRequest { id number repository { name owner { login } } }
      comments(first: 1) {
		nodes { id author { login } pullRequestReview { state } }
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
	viewerCanResolve: z.boolean(),
	viewerCanUnresolve: z.boolean(),
	viewerCanReply: z.boolean(),
	path: z.string(),
	line: z.number().nullable(),
	startLine: z.number().nullable(),
	diffSide: z.enum(GITHUB_DIFF_SIDE),
	startDiffSide: z.enum(GITHUB_DIFF_SIDE).nullable(),
	comments: GqlReviewCommentsPageSchema,
});

const GqlPullRequestIdentitySchema = z.object({
	id: z.string(),
	state: z.enum(["OPEN", "CLOSED", "MERGED"]),
	viewerDidAuthor: z.boolean(),
	headRefOid: z.string(),
	baseRefOid: z.string(),
	reviews: z.object({
		nodes: z.array(
			z.object({
				id: z.string(),
				body: z.string(),
				commit: z.object({ oid: z.string() }).nullable(),
			}),
		),
	}),
});

const ReviewQuerySchema = z.object({
	data: z.object({
		viewer: z.object({ login: z.string() }),
		repository: z
			.object({
				pullRequest: GqlPullRequestIdentitySchema.extend({
					reviewThreads: z.object({
						pageInfo: GqlPageInfoSchema,
						nodes: z.array(GqlReviewThreadSchema),
					}),
				}).nullable(),
			})
			.nullable(),
	}),
});

const ReviewIdentityQuerySchema = z.object({
	data: z.object({
		viewer: z.object({ login: z.string() }),
		repository: z.object({ pullRequest: GqlPullRequestIdentitySchema.nullable() }).nullable(),
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

const PromotionThreadQuerySchema = z.object({
	data: z.object({
		node: z
			.object({
				pullRequest: z.object({
					id: z.string(),
					number: z.number(),
					repository: z.object({
						name: z.string(),
						owner: z.object({ login: z.string() }),
					}),
				}),
				comments: z.object({
					nodes: z.array(
						z.object({
							id: z.string(),
							author: z.object({ login: z.string() }).nullable(),
							pullRequestReview: z.object({ state: z.string() }).nullable(),
						}),
					),
				}),
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
	viewerCanResolve: boolean;
	viewerCanUnresolve: boolean;
	viewerCanReply: boolean;
	path: string;
	line: number;
	startLine: number | null;
	side: GitHubDiffSide;
	startSide: GitHubDiffSide | null;
	comments: ReviewComment[];
}

/** A review thread retained for write recovery even when GitHub no longer exposes an anchor. */
export interface ReviewRecoveryThread extends Omit<ReviewThread, "line"> {
	line: number | null;
}

export interface GitHubReview {
	/** Authenticated viewer, used to distinguish their draft comments during recovery. */
	viewerLogin: string;
	/** GraphQL node id of the PR, required by the write mutations. */
	pullRequestNodeId: string;
	/** GitHub lifecycle state; only an open PR accepts review writes. */
	state: "OPEN" | "CLOSED" | "MERGED";
	/** True when the viewer opened the PR (GitHub forbids approving your own PR). */
	viewerDidAuthor: boolean;
	/** The PR's current head commit — comments anchor to this commit's diff. */
	headRefOid: string;
	/** Merge base of the PR's current base and head commits — the other half of its diff identity. */
	mergeBaseOid: string;
	/** The viewer's open pending review, or null when they have none. */
	pendingReviewNodeId: string | null;
	/** Commit the pending review is pinned to, or null when no review is open. */
	pendingReviewCommitOid: string | null;
	/** Existing summary text on the viewer's open pending review. */
	pendingReviewBody: string;
	/** Viewer's pending (draft) comments across all threads, including anchorless ones. */
	pendingCommentCount: number;
	pendingComments: PendingReviewComment[];
	/** All rooted threads, including outdated/anchorless ones hidden from the line-based UI. */
	recoveryThreads: ReviewRecoveryThread[];
	threads: ReviewThread[];
}

export interface PendingReviewComment {
	id: string;
	filePath: string;
	line: number | null;
	body: string;
}

export interface PromotionThreadState {
	repo: GitHubRepo;
	pullRequestNodeId: string;
	pullRequestNumber: number;
	rootCommentNodeId: string | null;
	rootAuthorLogin: string | null;
	rootIsPending: boolean;
}

const PENDING_STATE = "PENDING";
const THREAD_COMMENT_LOAD_CONCURRENCY = 5;

interface ReviewSnapshotIdentity {
	viewerLogin: string;
	pullRequestNodeId: string;
	state: GitHubReview["state"];
	viewerDidAuthor: boolean;
	headRefOid: string;
	baseRefOid: string;
	pendingReviewNodeId: string | null;
	pendingReviewCommitOid: string | null;
}

interface ReviewSnapshot {
	identity: ReviewSnapshotIdentity;
	pendingReviewBody: string;
}

function toReviewSnapshot(
	viewerLogin: string,
	pullRequest: z.infer<typeof GqlPullRequestIdentitySchema>,
): ReviewSnapshot {
	const pendingReview = pullRequest.reviews.nodes[0];
	return {
		identity: {
			viewerLogin,
			pullRequestNodeId: pullRequest.id,
			state: pullRequest.state,
			viewerDidAuthor: pullRequest.viewerDidAuthor,
			headRefOid: pullRequest.headRefOid,
			baseRefOid: pullRequest.baseRefOid,
			pendingReviewNodeId: pendingReview?.id ?? null,
			pendingReviewCommitOid: pendingReview?.commit?.oid ?? null,
		},
		pendingReviewBody: pendingReview?.body ?? "",
	};
}

function assertSameReviewIdentity(
	expected: ReviewSnapshotIdentity,
	actual: ReviewSnapshotIdentity,
): void {
	if (
		actual.viewerLogin !== expected.viewerLogin ||
		actual.pullRequestNodeId !== expected.pullRequestNodeId ||
		actual.headRefOid !== expected.headRefOid ||
		actual.baseRefOid !== expected.baseRefOid ||
		actual.state !== expected.state ||
		actual.viewerDidAuthor !== expected.viewerDidAuthor ||
		actual.pendingReviewNodeId !== expected.pendingReviewNodeId ||
		actual.pendingReviewCommitOid !== expected.pendingReviewCommitOid
	) {
		throw new Error("Pull request changed while GitHub review pages were loading");
	}
}

async function loadReviewSnapshot(
	repoRoot: string,
	repo: GitHubRepo,
	prNumber: number,
): Promise<ReviewSnapshot> {
	const args = [
		"api",
		"graphql",
		"-f",
		`query=${REVIEW_IDENTITY_QUERY}`,
		"-f",
		`owner=${repo.owner}`,
		"-f",
		`repo=${repo.repo}`,
		"-F",
		`number=${prNumber}`,
	];
	const parsed = ReviewIdentityQuerySchema.safeParse(
		JSON.parse(await ghReadOrThrow(args, repoRoot)),
	);
	if (!parsed.success) throw new Error("Unexpected response shape from GitHub review query");
	const pullRequest = parsed.data.data.repository?.pullRequest;
	if (!pullRequest) throw new Error("Pull request not found on GitHub");
	return toReviewSnapshot(parsed.data.data.viewer.login, pullRequest);
}

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
	let snapshotIdentity: ReviewSnapshotIdentity | null = null;
	let pendingReviewBody = "";
	let pendingCommentCount = 0;
	const pendingComments: PendingReviewComment[] = [];
	const recoveryThreads: ReviewRecoveryThread[] = [];
	const threads: ReviewThread[] = [];
	let loadedNestedCommentPage = false;
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
		const parsed = ReviewQuerySchema.safeParse(JSON.parse(await ghReadOrThrow(args, repoRoot)));
		if (!parsed.success) throw new Error("Unexpected response shape from GitHub review query");
		const pr = parsed.data.data.repository?.pullRequest;
		if (!pr) break;
		const pageSnapshot = toReviewSnapshot(parsed.data.data.viewer.login, pr);
		if (snapshotIdentity === null) snapshotIdentity = pageSnapshot.identity;
		else assertSameReviewIdentity(snapshotIdentity, pageSnapshot.identity);
		pendingReviewBody = pageSnapshot.pendingReviewBody;

		const nodesWithComments = await loadThreadCommentsInBatches(repoRoot, pr.reviewThreads.nodes);
		for (const { node, comments, loadedAdditionalPage } of nodesWithComments) {
			loadedNestedCommentPage ||= loadedAdditionalPage;
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
			if (!root) continue;
			const recoveryThread: ReviewRecoveryThread = {
				threadNodeId: node.id,
				isResolved: node.isResolved,
				viewerCanResolve: node.viewerCanResolve,
				viewerCanUnresolve: node.viewerCanUnresolve,
				viewerCanReply: node.viewerCanReply,
				path: node.path,
				line: node.line,
				startLine: node.startLine,
				side: node.diffSide,
				startSide: node.startDiffSide,
				comments: comments.map(toReviewComment),
			};
			recoveryThreads.push(recoveryThread);
			if (node.line === null) continue;
			threads.push({ ...recoveryThread, line: node.line });
		}
		cursor = nextCursor(pr.reviewThreads.pageInfo);
	} while (cursor !== null);

	// No `pullRequest` in the response (stale/unknown PR number, or repo no longer
	// resolves) — treat as unavailable rather than handing back an empty node id that
	// later write mutations would post against.
	if (snapshotIdentity === null) throw new Error("Pull request not found on GitHub");
	if (loadedNestedCommentPage) {
		const finalSnapshot = await loadReviewSnapshot(repoRoot, repo, prNumber);
		assertSameReviewIdentity(snapshotIdentity, finalSnapshot.identity);
		pendingReviewBody = finalSnapshot.pendingReviewBody;
	}
	const {
		viewerLogin,
		pullRequestNodeId,
		state,
		viewerDidAuthor,
		headRefOid,
		baseRefOid,
		pendingReviewNodeId,
		pendingReviewCommitOid,
	} = snapshotIdentity;
	const mergeBaseOid = await getPullRequestMergeBase(repoRoot, repo, baseRefOid, headRefOid);

	return {
		viewerLogin,
		pullRequestNodeId,
		state,
		viewerDidAuthor,
		headRefOid,
		mergeBaseOid,
		pendingReviewNodeId,
		pendingReviewCommitOid,
		pendingReviewBody,
		pendingCommentCount,
		pendingComments,
		recoveryThreads,
		threads,
	};
}

/** Read the remote root needed to reconcile an interrupted local-to-GitHub promotion. */
export async function getPromotionThreadState(
	repoRoot: string,
	threadNodeId: string,
): Promise<PromotionThreadState | null> {
	const stdout = await ghReadOrThrow(
		["api", "graphql", "-f", `query=${PROMOTION_THREAD_QUERY}`, "-f", `threadId=${threadNodeId}`],
		repoRoot,
	);
	const parsed = PromotionThreadQuerySchema.parse(JSON.parse(stdout));
	const node = parsed.data.node;
	if (node === null) return null;
	const root = node.comments.nodes[0];
	return {
		repo: {
			owner: node.pullRequest.repository.owner.login,
			repo: node.pullRequest.repository.name,
		},
		pullRequestNodeId: node.pullRequest.id,
		pullRequestNumber: node.pullRequest.number,
		rootCommentNodeId: root?.id ?? null,
		rootAuthorLogin: root?.author?.login ?? null,
		rootIsPending: root?.pullRequestReview?.state === PENDING_STATE,
	};
}

const MergeBaseOidSchema = z.string().min(1);

async function getPullRequestMergeBase(
	repoRoot: string,
	repo: GitHubRepo,
	baseRefOid: string,
	headRefOid: string,
): Promise<string> {
	const stdout = await ghReadOrThrow(
		[
			"api",
			`repos/${repo.owner}/${repo.repo}/compare/${baseRefOid}...${headRefOid}`,
			"--jq",
			".merge_base_commit.sha",
		],
		repoRoot,
	);
	return MergeBaseOidSchema.parse(stdout.trim());
}

async function loadThreadCommentsInBatches(
	repoRoot: string,
	nodes: z.infer<typeof GqlReviewThreadSchema>[],
): Promise<
	{
		node: z.infer<typeof GqlReviewThreadSchema>;
		comments: z.infer<typeof GqlReviewCommentSchema>[];
		loadedAdditionalPage: boolean;
	}[]
> {
	const loaded: {
		node: z.infer<typeof GqlReviewThreadSchema>;
		comments: z.infer<typeof GqlReviewCommentSchema>[];
		loadedAdditionalPage: boolean;
	}[] = [];
	for (let start = 0; start < nodes.length; start += THREAD_COMMENT_LOAD_CONCURRENCY) {
		const batch = nodes.slice(start, start + THREAD_COMMENT_LOAD_CONCURRENCY);
		loaded.push(
			...(await Promise.all(
				batch.map(async (node) => {
					const loadedComments = await loadReviewThreadComments(repoRoot, node.id, node.comments);
					return { node, ...loadedComments };
				}),
			)),
		);
	}
	return loaded;
}

async function loadReviewThreadComments(
	repoRoot: string,
	threadNodeId: string,
	firstPage: z.infer<typeof GqlReviewCommentsPageSchema>,
): Promise<{
	comments: z.infer<typeof GqlReviewCommentSchema>[];
	loadedAdditionalPage: boolean;
}> {
	const comments = [...firstPage.nodes];
	let cursor = nextCursor(firstPage.pageInfo);
	const loadedAdditionalPage = cursor !== null;
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
				JSON.parse(await ghReadOrThrow(args, repoRoot)),
			);
			if (!parsed.success || parsed.data.data.node === null) {
				throw new Error("Unexpected response shape from GitHub review comments query");
			}
			const page = parsed.data.data.node.comments;
			comments.push(...page.nodes);
			cursor = nextCursor(page.pageInfo);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(
				`Failed to load all comments for GitHub review thread ${threadNodeId}: ${message}`,
			);
		}
	}
	return { comments, loadedAdditionalPage };
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

const CREATE_PENDING_REVIEW = `mutation CreatePendingReview($pullRequestId: ID!, $commitOID: GitObjectID!) {
  addPullRequestReview(input: { pullRequestId: $pullRequestId, commitOID: $commitOID }) {
    pullRequestReview { id }
  }
}`;

const ADD_REVIEW_THREAD = `mutation AddReviewThread($pullRequestId: ID!, $reviewId: ID!, $path: String!, $body: String!, $line: Int!, $startLine: Int, $side: DiffSide!, $startSide: DiffSide) {
  addPullRequestReviewThread(input: { pullRequestId: $pullRequestId, pullRequestReviewId: $reviewId, path: $path, body: $body, line: $line, startLine: $startLine, side: $side, startSide: $startSide }) {
    thread { id viewerCanResolve comments(first: 1) { nodes { id } } }
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

function gqlInput(
	query: string,
	fields: Record<string, string | number | null>,
): { args: string[]; stdin: string } {
	return {
		args: ["api", "graphql", "--input", "-"],
		stdin: JSON.stringify({
			query,
			variables: Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null)),
		}),
	};
}

async function writeGraphql(
	repoRoot: string,
	query: string,
	fields: Record<string, string | number | null>,
): Promise<string> {
	const input = gqlInput(query, fields);
	return await ghWriteOrThrow(input.args, repoRoot, { stdin: input.stdin });
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
	commitOid: string,
): Promise<string> {
	const stdout = await writeGraphql(repoRoot, CREATE_PENDING_REVIEW, {
		pullRequestId: pullRequestNodeId,
		commitOID: commitOid,
	});
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

export interface AddImmediateReviewCommentInput {
	commitOid: string;
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
				viewerCanResolve: z.boolean(),
				comments: z.object({ nodes: z.array(z.object({ id: z.string() })) }),
			}),
		}),
	}),
});

export interface AddedReviewThread {
	threadNodeId: string;
	rootCommentNodeId: string;
	viewerCanResolve: boolean;
}

/** Add a line-anchored comment (a new thread) to a pending review. */
export async function addReviewThread(
	repoRoot: string,
	input: AddReviewThreadInput,
): Promise<AddedReviewThread> {
	const stdout = await writeGraphql(repoRoot, ADD_REVIEW_THREAD, {
		pullRequestId: input.pullRequestNodeId,
		reviewId: input.reviewNodeId,
		path: input.path,
		body: input.body,
		line: input.line,
		startLine: input.startLine,
		side: input.side,
		startSide: input.startSide,
	});
	const thread = AddedThreadSchema.parse(JSON.parse(stdout)).data.addPullRequestReviewThread.thread;
	const root = thread.comments.nodes[0];
	if (!root) throw new Error("GitHub returned a review thread without its root comment");
	return {
		threadNodeId: thread.id,
		rootCommentNodeId: root.id,
		viewerCanResolve: thread.viewerCanResolve,
	};
}

/** Publish a line-anchored review comment immediately, outside a pending review. */
export async function addImmediateReviewComment(
	repoRoot: string,
	repo: GitHubRepo,
	pullRequestNumber: number,
	input: AddImmediateReviewCommentInput,
): Promise<void> {
	const endpoint = `repos/${repo.owner}/${repo.repo}/pulls/${pullRequestNumber}/comments`;
	const body = Object.fromEntries(
		Object.entries({
			body: input.body,
			commit_id: input.commitOid,
			path: input.path,
			line: input.line,
			side: input.side,
			start_line: input.startLine,
			start_side: input.startSide,
		}).filter(([, value]) => value !== null),
	);
	await ghWriteOrThrow(["api", "--method", "POST", endpoint, "--input", "-"], repoRoot, {
		stdin: JSON.stringify(body),
	});
}

/** Reply to an existing thread, attaching the reply to a pending review when one is open. */
export async function addReviewReply(
	repoRoot: string,
	threadNodeId: string,
	body: string,
	reviewNodeId: string | null,
): Promise<string> {
	const stdout = await writeGraphql(repoRoot, ADD_REVIEW_REPLY, {
		threadId: threadNodeId,
		reviewId: reviewNodeId,
		body,
	});
	return AddedReplySchema.parse(JSON.parse(stdout)).data.addPullRequestReviewThreadReply.comment.id;
}

const AddedReplySchema = z.object({
	data: z.object({
		addPullRequestReviewThreadReply: z.object({ comment: z.object({ id: z.string() }) }),
	}),
});

/** Edit a review comment by node id (works for pending and submitted comments). */
export async function updateReviewComment(
	repoRoot: string,
	commentNodeId: string,
	body: string,
): Promise<void> {
	await writeGraphql(repoRoot, UPDATE_REVIEW_COMMENT, { commentId: commentNodeId, body });
}

/** Delete a review comment by node id (used for pending comments). */
export async function deleteReviewComment(repoRoot: string, commentNodeId: string): Promise<void> {
	await writeGraphql(repoRoot, DELETE_REVIEW_COMMENT, { commentId: commentNodeId });
}

/** Submit the pending review with the chosen event (Comment / Approve / Request changes). */
export async function submitReview(
	repoRoot: string,
	pullRequestNodeId: string,
	reviewNodeId: string,
	event: ReviewEvent,
	body: string,
): Promise<void> {
	await writeGraphql(repoRoot, SUBMIT_REVIEW, {
		pullRequestId: pullRequestNodeId,
		reviewId: reviewNodeId,
		event,
		body,
	});
}

/** Throw away the pending review and all its draft comments. */
export async function discardReview(repoRoot: string, reviewNodeId: string): Promise<void> {
	await writeGraphql(repoRoot, DISCARD_REVIEW, { reviewId: reviewNodeId });
}

/** Resolve or reopen a review thread by its node id. */
export async function setThreadResolved(
	repoRoot: string,
	threadNodeId: string,
	resolved: boolean,
): Promise<void> {
	await writeGraphql(repoRoot, resolved ? RESOLVE_THREAD : UNRESOLVE_THREAD, {
		threadId: threadNodeId,
	});
}
