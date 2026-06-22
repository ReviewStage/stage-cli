import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { gh, ghErrorMessage } from "./exec.js";
import type { GitHubRepo } from "./repo.js";

const execFileAsync = promisify(execFile);

/**
 * GitHub's diff sides. `LEFT` is the base/deletion side, `RIGHT` the head/addition
 * side. These map onto the local `DIFF_SIDE` (deletions/additions) in the sync layer.
 */
export const GITHUB_DIFF_SIDE = {
	LEFT: "LEFT",
	RIGHT: "RIGHT",
} as const;
export type GitHubDiffSide = (typeof GITHUB_DIFF_SIDE)[keyof typeof GITHUB_DIFF_SIDE];

// REST review-comment shape we anchor on. `line` is null for an outdated comment
// (its line is no longer in the diff); `start_line` is null for single-line ones.
const ReviewCommentSchema = z.object({
	id: z.number(),
	in_reply_to_id: z.number().nullable().optional(),
	path: z.string(),
	line: z.number().nullable(),
	start_line: z.number().nullable().optional(),
	side: z.enum(GITHUB_DIFF_SIDE).nullable().optional(),
	body: z.string(),
	created_at: z.string(),
	user: z.object({ login: z.string(), avatar_url: z.string(), type: z.string() }).nullable(),
});
export type ReviewComment = z.infer<typeof ReviewCommentSchema>;

/**
 * All review comments on a PR, oldest-first across pages. Unlike the read
 * adapters that back passive PR context, sync is user-initiated, so a `gh`
 * failure throws rather than degrading to an empty list.
 */
export async function listReviewComments(
	repoRoot: string,
	repo: GitHubRepo,
	prNumber: number,
): Promise<ReviewComment[]> {
	// `--slurp` wraps each page in one array (`[[…], […]]`) so multi-page output stays valid JSON.
	const stdout = await ghOrThrow(
		["api", `repos/${repo.owner}/${repo.repo}/pulls/${prNumber}/comments`, "--paginate", "--slurp"],
		repoRoot,
	);
	const parsed = z.array(z.array(ReviewCommentSchema)).safeParse(JSON.parse(stdout));
	if (!parsed.success) throw new Error("Unexpected response shape from GitHub review comments");
	return parsed.data.flat();
}

// ─── Review-thread metadata (GraphQL) ───────────────────────────────────────────

const REVIEW_THREADS_QUERY = `query GetReviewThreads($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          comments(first: 1) { nodes { databaseId } }
        }
      }
    }
  }
}`;

const ReviewThreadsSchema = z.object({
	data: z.object({
		repository: z
			.object({
				pullRequest: z
					.object({
						reviewThreads: z.object({
							pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
							nodes: z.array(
								z.object({
									id: z.string(),
									isResolved: z.boolean(),
									comments: z.object({
										nodes: z.array(z.object({ databaseId: z.number().nullable() })),
									}),
								}),
							),
						}),
					})
					.nullable(),
			})
			.nullable(),
	}),
});

/** A PR review thread's GraphQL node id and resolution state. */
export interface ReviewThreadInfo {
	nodeId: string;
	isResolved: boolean;
}

/**
 * Review threads keyed by their root comment's database id (the same id the REST
 * list reports for the thread's first comment). The node id is needed to resolve
 * or reopen a thread; the resolution state mirrors GitHub onto the local review.
 * We key off the root comment id we already store, so nothing GitHub-owned needs
 * persisting — the node id is looked up live when a thread is resolved.
 */
export async function listReviewThreads(
	repoRoot: string,
	repo: GitHubRepo,
	prNumber: number,
): Promise<Map<number, ReviewThreadInfo>> {
	const byRootCommentId = new Map<number, ReviewThreadInfo>();
	let cursor: string | null = null;
	do {
		const args = [
			"api",
			"graphql",
			"-f",
			`query=${REVIEW_THREADS_QUERY}`,
			"-F",
			`owner=${repo.owner}`,
			"-F",
			`repo=${repo.repo}`,
			"-F",
			`number=${prNumber}`,
		];
		if (cursor !== null) args.push("-F", `cursor=${cursor}`);
		const stdout = await ghOrThrow(args, repoRoot);
		const parsed = ReviewThreadsSchema.safeParse(JSON.parse(stdout));
		if (!parsed.success) throw new Error("Unexpected response shape from GitHub review threads");
		const threads = parsed.data.data.repository?.pullRequest?.reviewThreads;
		if (!threads) break;
		for (const thread of threads.nodes) {
			const rootId = thread.comments.nodes[0]?.databaseId;
			if (rootId != null) {
				byRootCommentId.set(rootId, { nodeId: thread.id, isResolved: thread.isResolved });
			}
		}
		cursor = threads.pageInfo.hasNextPage ? threads.pageInfo.endCursor : null;
	} while (cursor !== null);
	return byRootCommentId;
}

const RESOLVE_THREAD_MUTATION = `mutation ResolveThread($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) { thread { id } }
}`;

const UNRESOLVE_THREAD_MUTATION = `mutation UnresolveThread($threadId: ID!) {
  unresolveReviewThread(input: { threadId: $threadId }) { thread { id } }
}`;

/** Resolve or reopen a review thread by its GraphQL node id. Throws on failure. */
export async function setReviewThreadResolved(
	repoRoot: string,
	threadNodeId: string,
	resolved: boolean,
): Promise<void> {
	await ghWrite(
		[
			"api",
			"graphql",
			"-f",
			`query=${resolved ? RESOLVE_THREAD_MUTATION : UNRESOLVE_THREAD_MUTATION}`,
			"-F",
			`threadId=${threadNodeId}`,
		],
		repoRoot,
	);
}

// ─── Writes ─────────────────────────────────────────────────────────────────────

export interface CreateReviewCommentInput {
	commitId: string;
	path: string;
	body: string;
	side: GitHubDiffSide;
	/** End line of the comment (single-line comments set only this). */
	line: number;
	/** Set with `startSide` for a multi-line comment. */
	startLine?: number;
	startSide?: GitHubDiffSide;
}

const CreatedCommentSchema = z.object({ id: z.number() });

/** Create a new review comment on the PR, returning its GitHub id. Throws on failure. */
export async function createReviewComment(
	repoRoot: string,
	repo: GitHubRepo,
	prNumber: number,
	input: CreateReviewCommentInput,
): Promise<number> {
	// `-f` sends a string field, `-F` a typed (numeric) one; together they form the
	// JSON request body `gh api` POSTs. Each value is a single argv entry, so commit
	// bodies with newlines or shell metacharacters pass through untouched.
	const args = [
		"api",
		`repos/${repo.owner}/${repo.repo}/pulls/${prNumber}/comments`,
		"--method",
		"POST",
		"-f",
		`body=${input.body}`,
		"-f",
		`commit_id=${input.commitId}`,
		"-f",
		`path=${input.path}`,
		"-f",
		`side=${input.side}`,
		"-F",
		`line=${input.line}`,
	];
	if (input.startLine !== undefined && input.startSide !== undefined) {
		args.push("-F", `start_line=${input.startLine}`, "-f", `start_side=${input.startSide}`);
	}
	const stdout = await ghWrite(args, repoRoot);
	return CreatedCommentSchema.parse(JSON.parse(stdout)).id;
}

/** Reply to an existing review comment thread, returning the new comment's GitHub id. */
export async function replyToReviewComment(
	repoRoot: string,
	repo: GitHubRepo,
	prNumber: number,
	inReplyToId: number,
	body: string,
): Promise<number> {
	const stdout = await ghWrite(
		[
			"api",
			`repos/${repo.owner}/${repo.repo}/pulls/${prNumber}/comments/${inReplyToId}/replies`,
			"--method",
			"POST",
			"-f",
			`body=${body}`,
		],
		repoRoot,
	);
	return CreatedCommentSchema.parse(JSON.parse(stdout)).id;
}

/** Read-only `gh` call that surfaces failures (sync is user-initiated, not passive context). */
async function ghOrThrow(args: string[], repoRoot: string): Promise<string> {
	try {
		return await gh(args, repoRoot);
	} catch (err) {
		throw new Error(ghErrorMessage(err));
	}
}

/** Run a `gh` write command, returning stdout and surfacing failures with gh's stderr message. */
async function ghWrite(args: string[], repoRoot: string): Promise<string> {
	try {
		const { stdout } = await execFileAsync("gh", args, {
			cwd: repoRoot,
			encoding: "utf8",
			maxBuffer: 10 * 1024 * 1024,
		});
		return stdout;
	} catch (err) {
		throw new Error(ghErrorMessage(err));
	}
}
