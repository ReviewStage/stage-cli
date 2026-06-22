import type { PullCommentsResult, PushCommentsResult } from "@stagereview/types/comments";
import { asc, eq } from "drizzle-orm";
import type { StageDb } from "../db/client.js";
import { LOCAL_USER_ID } from "../db/local-user.js";
import { type ChapterRunRow, type CommentRow, comment, commentThread } from "../db/schema/index.js";
import { isWorkingTreeClean, readHeadSha } from "../git.js";
import {
	createReviewComment,
	type GitHubRepo,
	getPullRequest,
	listResolvedRootCommentIds,
	listReviewComments,
	parseGitHubRepo,
	type ReviewComment,
	replyToReviewComment,
} from "../github/index.js";
import { SCOPE_KIND } from "../schema.js";
import { groupReviewComments, toGitHubSide } from "./review-comment-mapping.js";
import { deriveScopeKey } from "./scope-key.js";

/**
 * A sync failure with a user-facing message and the HTTP status the route should
 * return. Guardrail violations (409) and missing-PR errors (404) reach the user
 * verbatim, so the UI can explain exactly why a sync didn't run.
 */
export class CommentSyncError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "CommentSyncError";
	}
}

interface SyncTarget {
	repo: GitHubRepo;
	prNumber: number;
	headSha: string;
}

/**
 * Resolve the GitHub PR a run targets, including its current head SHA. Throws a
 * CommentSyncError when the run has no GitHub remote or no detectable PR — both
 * are conditions the user needs to see, not silent no-ops.
 */
async function resolveSyncTarget(run: ChapterRunRow): Promise<SyncTarget> {
	const repo = parseGitHubRepo(run.originUrl);
	if (!repo) {
		throw new CommentSyncError("This run isn't associated with a GitHub remote.", 404);
	}
	const pullRequest = await getPullRequest(run.repoRoot, run.originUrl, run.prNumber);
	if (!pullRequest) {
		throw new CommentSyncError(
			"No GitHub pull request found for this run. Ensure `gh` is authenticated and the branch has an open PR.",
			404,
		);
	}
	return { repo, prNumber: pullRequest.number, headSha: pullRequest.head.sha };
}

// ─── Pull (GitHub → local) ──────────────────────────────────────────────────────

/**
 * Import the PR's review comments into the run's local review. Idempotent: every
 * comment is keyed by its GitHub id, so re-pulling skips comments already present
 * and never duplicates. Resolved threads on GitHub mark their local thread
 * resolved (non-destructive — locally-reopened threads aren't forced back closed).
 */
export async function pullComments(db: StageDb, run: ChapterRunRow): Promise<PullCommentsResult> {
	const { repo, prNumber } = await resolveSyncTarget(run);
	const scopeKey = deriveScopeKey(run);
	const [comments, resolvedRootIds] = await Promise.all([
		listReviewComments(run.repoRoot, repo, prNumber),
		listResolvedRootCommentIds(run.repoRoot, repo, prNumber),
	]);
	const threads = groupReviewComments(comments);

	return db.transaction((tx) => {
		let pulled = 0;
		let skipped = 0;

		const insertComment = (threadId: string, c: ReviewComment): boolean => {
			const existing = tx
				.select({ id: comment.id })
				.from(comment)
				.where(eq(comment.githubCommentId, c.id))
				.limit(1)
				.all();
			if (existing.length > 0) return false;
			tx.insert(comment)
				.values({
					threadId,
					authorId: c.user?.login ?? "ghost",
					authorAvatarUrl: c.user?.avatar_url ?? null,
					body: c.body,
					githubCommentId: c.id,
				})
				.run();
			return true;
		};

		for (const thread of threads) {
			// Reuse the local thread that already owns the root comment; otherwise create one.
			const [existingRoot] = tx
				.select({ threadId: comment.threadId })
				.from(comment)
				.where(eq(comment.githubCommentId, thread.root.id))
				.limit(1)
				.all();

			let threadId: string;
			if (existingRoot) {
				threadId = existingRoot.threadId;
				skipped++;
			} else {
				const resolvedAt = resolvedRootIds.has(thread.root.id) ? new Date() : null;
				const [threadRow] = tx
					.insert(commentThread)
					.values({
						scopeKey,
						filePath: thread.filePath,
						side: thread.side,
						startLine: thread.startLine,
						endLine: thread.endLine,
						resolvedAt,
					})
					.returning({ id: commentThread.id })
					.all();
				if (!threadRow) throw new Error("comment_thread insert returned no row");
				threadId = threadRow.id;
				insertComment(threadId, thread.root);
				pulled++;
			}

			for (const reply of thread.replies) {
				if (insertComment(threadId, reply)) pulled++;
				else skipped++;
			}
		}

		return { pulled, skipped };
	});
}

// ─── Push (local → GitHub) ────────────────────────────────────────────────────────

/**
 * Block the push unless the local checkout safely matches the PR. PR review
 * comments anchor to committed diff positions, so a working-tree scope, a dirty
 * tree, or a head that has diverged from the PR would all land comments
 * mis-anchored. These are loud failures, not silent skips.
 */
function assertPushable(run: ChapterRunRow, target: SyncTarget): void {
	if (run.scopeKind !== SCOPE_KIND.COMMITTED) {
		throw new CommentSyncError(
			"Only comments on a committed diff can be pushed. Working-tree comments aren't anchored to commits.",
			409,
		);
	}
	if (!isWorkingTreeClean(run.repoRoot)) {
		throw new CommentSyncError(
			"Your working tree has uncommitted changes. Commit or stash them so comments anchor to the pushed commit.",
			409,
		);
	}
	const localHead = readHeadSha(run.repoRoot);
	if (localHead !== target.headSha) {
		throw new CommentSyncError(
			"Your local HEAD doesn't match the PR head. Push or pull your commits so they line up before syncing.",
			409,
		);
	}
}

interface ThreadWithComments {
	thread: typeof commentThread.$inferSelect;
	comments: CommentRow[];
}

function loadThreads(db: StageDb, scopeKey: string): ThreadWithComments[] {
	const threads = db
		.select()
		.from(commentThread)
		.where(eq(commentThread.scopeKey, scopeKey))
		.orderBy(asc(commentThread.createdAt))
		.all();
	return threads.map((thread) => ({
		thread,
		comments: db
			.select()
			.from(comment)
			.where(eq(comment.threadId, thread.id))
			.orderBy(asc(comment.createdAt))
			.all(),
	}));
}

/**
 * Push locally-authored comments to the PR. Comments pulled from GitHub or already
 * synced are skipped; each new comment records its GitHub id on success so a later
 * push or pull treats it as already-synced. A comment GitHub rejects (e.g. its line
 * isn't in the PR diff) is reported as a per-comment failure without aborting the rest.
 *
 * Known limitation: a deletion-side comment authored on a chapter view anchors to
 * that view's synthetic intermediate-file line numbers, which can differ from the
 * PR's canonical old-line coordinates. Addition-side anchors are always canonical.
 * Canonicalizing deletion-side anchors is deferred; GitHub's own "line not in diff"
 * rejection is the backstop here, surfacing such a comment as a loud failure rather
 * than letting it land mis-anchored silently.
 */
export async function pushComments(db: StageDb, run: ChapterRunRow): Promise<PushCommentsResult> {
	const target = await resolveSyncTarget(run);
	assertPushable(run, target);

	const result: PushCommentsResult = { pushed: 0, skipped: 0, failed: [] };
	const scopeKey = deriveScopeKey(run);

	const recordSynced = (commentId: string, githubCommentId: number): void => {
		db.update(comment).set({ githubCommentId }).where(eq(comment.id, commentId)).run();
	};

	for (const { thread, comments } of loadThreads(db, scopeKey)) {
		const side = toGitHubSide(thread.side);
		// GitHub multi-line comments need a start anchor only when the range spans lines.
		const startLine = thread.endLine !== thread.startLine ? thread.startLine : undefined;
		// Track the root's GitHub id in memory so a reply pushed in the same pass can anchor to it.
		const rootGithubId = comments[0]?.githubCommentId ?? null;
		let liveRootGithubId = rootGithubId;

		for (let i = 0; i < comments.length; i++) {
			const c = comments[i];
			if (!c) continue;
			// Only locally-authored comments are ours to push; GitHub-authored ones came from the PR.
			if (c.authorId !== LOCAL_USER_ID) {
				if (i === 0) liveRootGithubId = c.githubCommentId;
				continue;
			}
			if (c.githubCommentId !== null) {
				result.skipped++;
				if (i === 0) liveRootGithubId = c.githubCommentId;
				continue;
			}

			try {
				if (i === 0) {
					const id = await createReviewComment(run.repoRoot, target.repo, target.prNumber, {
						commitId: target.headSha,
						path: thread.filePath,
						body: c.body,
						side,
						line: thread.endLine,
						startLine,
						startSide: startLine !== undefined ? side : undefined,
					});
					recordSynced(c.id, id);
					liveRootGithubId = id;
					result.pushed++;
				} else if (liveRootGithubId !== null) {
					const id = await replyToReviewComment(
						run.repoRoot,
						target.repo,
						target.prNumber,
						liveRootGithubId,
						c.body,
					);
					recordSynced(c.id, id);
					result.pushed++;
				} else {
					result.failed.push({
						filePath: thread.filePath,
						line: thread.endLine,
						message:
							"The thread's first comment wasn't pushed, so the reply has nothing to anchor to.",
					});
				}
			} catch (err) {
				result.failed.push({
					filePath: thread.filePath,
					line: thread.endLine,
					message: err instanceof Error ? err.message : "Failed to push comment to GitHub.",
				});
			}
		}
	}

	return result;
}
