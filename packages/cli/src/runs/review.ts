import {
	COMMENT_STATE,
	GITHUB_REVIEW_STATUS,
	type GitHubReviewComment as GitHubReviewCommentDto,
	type GitHubReviewThread as GitHubReviewThreadDto,
	type LocalReviewComment as LocalReviewCommentDto,
	type LocalReviewThread as LocalReviewThreadDto,
	REVIEW_EVENT,
	type ReviewEvent,
	type ReviewResponse,
	type ReviewThread as ReviewThreadDto,
	THREAD_SOURCE,
} from "@stagereview/types/review";
import { and, asc, eq } from "drizzle-orm";
import type { StageDb } from "../db/client.js";
import {
	type ChapterRunRow,
	comment,
	commentInsertionOrder,
	commentThread,
} from "../db/schema/index.js";
import { type GitHubRepo, getPullRequestOrThrow, parseGitHubRepo } from "../github/index.js";
import {
	addImmediateReviewComment,
	addReviewReply,
	addReviewThread,
	createPendingReview,
	deleteReviewComment,
	discardReview,
	GITHUB_DIFF_SIDE,
	type ReviewComment as GitHubApiReviewComment,
	type ReviewThread as GitHubApiReviewThread,
	type GitHubDiffSide,
	type GitHubReview,
	getReview,
	setThreadResolved,
	submitReview,
	updateReviewComment,
} from "../github/review.js";
import { DIFF_SIDE, type DiffSide, SCOPE_KIND } from "../schema.js";
import { loadLocalThreadRecords, UNASSIGNED_REPO_ROOT } from "./local-comment-threads.js";
import { REVIEW_ACTION_SCOPE, reviewActions } from "./review-action-queue.js";
import { deriveScopeKey } from "./scope-key.js";

/** A review action failure with a user-facing message and the route's HTTP status. */
export class ReviewError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "ReviewError";
	}
}

// LEFT is GitHub's base/deletion side, RIGHT the head/addition side.
function toGitHubSide(side: DiffSide): GitHubDiffSide {
	return side === DIFF_SIDE.DELETIONS ? GITHUB_DIFF_SIDE.LEFT : GITHUB_DIFF_SIDE.RIGHT;
}

function fromGitHubSide(side: GitHubDiffSide): DiffSide {
	return side === GITHUB_DIFF_SIDE.LEFT ? DIFF_SIDE.DELETIONS : DIFF_SIDE.ADDITIONS;
}

/**
 * Whether the run's diff IS the PR's current diff. GitHub anchors review comments to
 * the PR head-commit's diff, and a run's comment anchors are line numbers from its
 * own `base..head`. So the two align only when the run is a committed diff (working-
 * tree line numbers aren't the PR's) whose head and merge base match the PR diff.
 * This is the load-bearing invariant for both showing live PR threads and adding
 * comments to the PR; the live worktree state is irrelevant — a committed run's
 * anchors are fixed by its recorded SHAs.
 */
function runMatchesPrDiff(run: ChapterRunRow, review: GitHubReview): boolean {
	return (
		run.scopeKind === SCOPE_KIND.COMMITTED &&
		run.headSha === review.headRefOid &&
		run.mergeBaseSha === review.mergeBaseOid
	);
}

function assertGitHubWritable(run: ChapterRunRow, review: GitHubReview): void {
	if (review.state !== "OPEN") {
		throw new ReviewError("This pull request is closed, so its review is read-only.", 409);
	}
	if (runMatchesPrDiff(run, review)) return;
	const reason =
		run.scopeKind !== SCOPE_KIND.COMMITTED
			? "Only comments on a committed diff can be added to the PR — working-tree comments aren't anchored to the PR's commits."
			: "This run's diff doesn't match the current PR diff. Re-run against the latest PR base and head to comment on it.";
	throw new ReviewError(reason, 409);
}

function canWriteToGitHub(run: ChapterRunRow, review: GitHubReview): boolean {
	return review.state === "OPEN" && runMatchesPrDiff(run, review);
}

function requireReviewThread(review: GitHubReview, threadNodeId: string): GitHubApiReviewThread {
	const thread = review.threads.find((candidate) => candidate.threadNodeId === threadNodeId);
	if (thread) return thread;
	throw new ReviewError("That GitHub review thread doesn't belong to this pull request.", 400);
}

function requirePendingComment(review: GitHubReview, nodeId: string): GitHubApiReviewComment {
	const comment = review.recoveryThreads
		.flatMap((thread) => thread.comments)
		.find((candidate) => candidate.nodeId === nodeId);
	if (comment?.isPending) return comment;
	throw new ReviewError(
		"That GitHub comment isn't an editable pending comment on this pull request.",
		400,
	);
}

// ─── Read: merged local + GitHub review ─────────────────────────────────────────

function loadLocalThreads(db: StageDb, run: ChapterRunRow): ReviewThreadDto[] {
	return loadLocalThreadRecords(db, {
		repoRoot: run.repoRoot,
		scopeKey: deriveScopeKey(run),
	}).map(({ thread, comments }): LocalReviewThreadDto => {
		return {
			id: thread.id,
			source: THREAD_SOURCE.LOCAL,
			threadNodeId: null,
			filePath: thread.filePath,
			side: thread.side,
			startLine: thread.startLine,
			endLine: thread.endLine,
			isResolved: thread.resolvedAt !== null,
			comments: comments.map(
				(c): LocalReviewCommentDto => ({
					id: c.id,
					state: COMMENT_STATE.LOCAL,
					body: c.body,
					bodyHtml: null,
					author: null,
					nodeId: null,
					htmlUrl: null,
					createdAt: c.createdAt.toISOString(),
				}),
			),
		};
	});
}

function toGitHubThreadDto(t: GitHubApiReviewThread): GitHubReviewThreadDto {
	// `line` is non-null (getReview drops anchorless threads); start defaults to line.
	const endLine = t.line;
	return {
		id: t.threadNodeId,
		source: THREAD_SOURCE.GITHUB,
		threadNodeId: t.threadNodeId,
		filePath: t.path,
		side: fromGitHubSide(t.side),
		startSide: fromGitHubSide(t.startSide ?? t.side),
		startLine: t.startLine ?? endLine,
		endLine,
		isResolved: t.isResolved,
		viewerCanResolve: t.viewerCanResolve,
		viewerCanUnresolve: t.viewerCanUnresolve,
		viewerCanReply: t.viewerCanReply,
		comments: t.comments.map(
			(c): GitHubReviewCommentDto => ({
				id: c.nodeId,
				state: c.isPending ? COMMENT_STATE.PENDING : COMMENT_STATE.SUBMITTED,
				body: c.body,
				bodyHtml: c.bodyHtml,
				author: { login: c.authorLogin, avatarUrl: c.authorAvatarUrl || null },
				nodeId: c.nodeId,
				htmlUrl: c.htmlUrl,
				createdAt: c.createdAt,
			}),
		),
	};
}

/**
 * The run's full review: local threads from the DB merged with the PR's live
 * GitHub threads (pending + submitted). GitHub failures degrade to `offline`
 * (local comments still render) rather than throwing — the read backs passive
 * rendering, so it never blanks the review.
 */
export async function getReviewForRun(db: StageDb, run: ChapterRunRow): Promise<ReviewResponse> {
	const localThreads = loadLocalThreads(db, run);
	const base = {
		threads: localThreads,
		pendingComments: [],
		hasPendingReview: false,
		pendingReviewBody: "",
		isOwnPullRequest: false,
		canWriteToGitHub: false,
	};

	const repo = parseGitHubRepo(run.originUrl);
	if (!repo) return { ...base, github: GITHUB_REVIEW_STATUS.NONE };
	const hasStoredPullRequest = run.prNumber !== null;

	let review: GitHubReview;
	try {
		let prNumber = run.prNumber;
		if (prNumber === null) {
			const pr = await getPullRequestOrThrow(run.repoRoot, run.originUrl, null);
			prNumber = pr?.number ?? null;
		}
		if (prNumber === null) return { ...base, github: GITHUB_REVIEW_STATUS.NONE };
		review = await getReview(run.repoRoot, repo, prNumber);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`Failed to load GitHub review: ${message}\n`);
		return { ...base, github: GITHUB_REVIEW_STATUS.OFFLINE };
	}

	// The PR's live threads anchor to its head-commit diff. If this run isn't that
	// exact diff, overlaying them would mis-anchor comments on unrelated lines, so we
	// surface only local line threads. Keep the pending-review lifecycle visible so
	// the viewer can inspect and discard drafts even though this run is read-only.
	if (!runMatchesPrDiff(run, review)) {
		// Automatic discovery follows the checkout's current branch, not the branch
		// that created this historical run. A mismatch therefore cannot safely retain
		// lifecycle controls: they may belong to an entirely different pull request.
		if (!hasStoredPullRequest) return { ...base, github: GITHUB_REVIEW_STATUS.NONE };
		return {
			...base,
			github: GITHUB_REVIEW_STATUS.AVAILABLE,
			pendingComments: review.pendingComments,
			hasPendingReview: review.pendingReviewNodeId !== null,
			pendingReviewBody: review.pendingReviewBody,
			isOwnPullRequest: review.viewerDidAuthor,
		};
	}

	const githubThreads = review.threads.map(toGitHubThreadDto);
	return {
		github: GITHUB_REVIEW_STATUS.AVAILABLE,
		threads: [...localThreads, ...githubThreads],
		pendingComments: review.pendingComments,
		hasPendingReview: review.pendingReviewNodeId !== null,
		pendingReviewBody: review.pendingReviewBody,
		isOwnPullRequest: review.viewerDidAuthor,
		canWriteToGitHub: canWriteToGitHub(run, review),
	};
}

// ─── Write: review actions ──────────────────────────────────────────────────────

interface ReviewTarget {
	repo: GitHubRepo;
	prNumber: number;
	review: GitHubReview;
}

interface ReviewIdentity {
	repo: GitHubRepo;
	prNumber: number;
}

/** Resolve the run's repository and pull request without reading mutable review state. */
async function resolveReviewIdentity(run: ChapterRunRow): Promise<ReviewIdentity> {
	const repo = parseGitHubRepo(run.originUrl);
	if (!repo) throw new ReviewError("This run isn't associated with a GitHub remote.", 404);
	let prNumber = run.prNumber;
	if (prNumber === null) {
		const pr = await getPullRequestOrThrow(run.repoRoot, run.originUrl, null);
		prNumber = pr?.number ?? null;
	}
	if (prNumber === null) {
		throw new ReviewError("No GitHub pull request found for this run.", 404);
	}
	return { repo, prNumber };
}

/**
 * Resolve the PR, serialize on its action queue, then read fresh review state
 * before performing a mutation.
 */
async function withLockedReviewTarget<T>(
	run: ChapterRunRow,
	action: (target: ReviewTarget) => Promise<T>,
): Promise<T> {
	const identity = await resolveReviewIdentity(run);
	return reviewActions.run(
		{
			kind: REVIEW_ACTION_SCOPE.PULL_REQUEST,
			owner: identity.repo.owner,
			repo: identity.repo.repo,
			prNumber: identity.prNumber,
		},
		async () => {
			const review = await getReview(run.repoRoot, identity.repo, identity.prNumber);
			return action({ ...identity, review });
		},
	);
}

/** The viewer's pending review node id, opening an empty pending review if none is open. */
async function openPendingReview(run: ChapterRunRow, review: GitHubReview): Promise<string> {
	if (review.pendingReviewNodeId !== null) {
		return review.pendingReviewNodeId;
	}
	return createPendingReview(run.repoRoot, review.pullRequestNodeId, review.headRefOid);
}

/** Run an action against the viewer's pending review, opening one if needed. */
async function withPendingReview<T>(
	run: ChapterRunRow,
	target: ReviewTarget,
	action: (reviewNodeId: string) => Promise<T>,
): Promise<T> {
	const reviewNodeId = await openPendingReview(run, target.review);
	return action(reviewNodeId);
}

const promotionsInFlight = new Set<string>();

/** True only for a promotion queued or running in this process. */
export function isLocalThreadPromotionInFlight(localThreadId: string): boolean {
	return promotionsInFlight.has(localThreadId);
}

/**
 * Promote a local comment thread to the viewer's pending GitHub review: the root
 * becomes a new review thread, replies become pending replies, and the local thread
 * is removed (it now lives on GitHub as pending). GitHub anchors the comment to the
 * PR's current diff, so a line not in that diff is rejected and surfaced as an error.
 *
 * Promotion is best-effort, not resumable: if it fails partway, the local thread is
 * kept and any comments that already reached GitHub stay there — retrying can post
 * them again, and the duplicates are cleaned up in the GitHub UI.
 */
export async function addLocalThreadToReview(
	db: StageDb,
	run: ChapterRunRow,
	localThreadId: string,
): Promise<void> {
	if (promotionsInFlight.has(localThreadId)) {
		throw new ReviewError("This comment is already being added to the review.", 409);
	}
	promotionsInFlight.add(localThreadId);
	try {
		await reviewActions.run(
			{ kind: REVIEW_ACTION_SCOPE.LOCAL_THREAD, threadId: localThreadId },
			() => promoteLocalThread(db, run, localThreadId),
		);
	} finally {
		promotionsInFlight.delete(localThreadId);
	}
}

async function promoteLocalThread(
	db: StageDb,
	run: ChapterRunRow,
	localThreadId: string,
): Promise<void> {
	const [thread] = db
		.select()
		.from(commentThread)
		.where(eq(commentThread.id, localThreadId))
		.limit(1)
		.all();
	if (!thread) throw new ReviewError(`Thread ${localThreadId} not found`, 404);
	if (thread.repoRoot !== run.repoRoot && thread.repoRoot !== UNASSIGNED_REPO_ROOT) {
		throw new ReviewError("This comment belongs to another repository.", 400);
	}
	// The thread must belong to this run's diff scope; its anchor was computed
	// against that diff, so promoting one from another scope would mis-anchor.
	if (thread.scopeKey !== deriveScopeKey(run)) {
		throw new ReviewError("This comment doesn't belong to this run's diff.", 400);
	}
	const comments = db
		.select()
		.from(comment)
		.where(eq(comment.threadId, localThreadId))
		.orderBy(asc(comment.createdAt), asc(commentInsertionOrder))
		.all();
	const root = comments[0];
	if (!root) throw new ReviewError("Thread has no comments to add to the review.", 400);
	const replies = comments.slice(1);

	await withLockedReviewTarget(run, async (target) => {
		const { review } = target;
		assertGitHubWritable(run, review);
		const wasUnassigned = thread.repoRoot === UNASSIGNED_REPO_ROOT;
		if (wasUnassigned) {
			const [claimed] = db
				.update(commentThread)
				.set({ repoRoot: run.repoRoot })
				.where(
					and(
						eq(commentThread.id, localThreadId),
						eq(commentThread.repoRoot, UNASSIGNED_REPO_ROOT),
					),
				)
				.returning({ id: commentThread.id })
				.all();
			if (!claimed) {
				throw new ReviewError("This comment belongs to another repository.", 400);
			}
		}
		try {
			const side = toGitHubSide(thread.side);
			const startLine = thread.endLine !== thread.startLine ? thread.startLine : null;
			const reviewNodeId = await openPendingReview(run, review);
			const addedThread = await addReviewThread(run.repoRoot, {
				pullRequestNodeId: review.pullRequestNodeId,
				reviewNodeId,
				path: thread.filePath,
				body: root.body,
				line: thread.endLine,
				side,
				startLine,
				startSide: startLine !== null ? side : null,
			});
			for (const reply of replies) {
				await addReviewReply(run.repoRoot, addedThread.threadNodeId, reply.body, reviewNodeId);
			}
			if (thread.resolvedAt !== null) {
				if (!addedThread.viewerCanResolve) {
					throw new ReviewError(
						"GitHub doesn't allow you to resolve this promoted review thread.",
						403,
					);
				}
				await setThreadResolved(run.repoRoot, addedThread.threadNodeId, true);
			}
		} catch (err) {
			if (wasUnassigned) {
				db.update(commentThread)
					.set({ repoRoot: UNASSIGNED_REPO_ROOT })
					.where(and(eq(commentThread.id, localThreadId), eq(commentThread.repoRoot, run.repoRoot)))
					.run();
			}
			throw err;
		}
		// Every comment landed remotely; the cascade removes all local comment rows.
		db.delete(commentThread).where(eq(commentThread.id, localThreadId)).run();
	});
}

export interface GitHubCommentAnchor {
	filePath: string;
	side: DiffSide;
	startLine: number;
	endLine: number;
	body: string;
	pending: boolean;
}

/**
 * Create a comment directly on the PR, either in the viewer's pending review or as
 * an immediately published comment. Unlike `addLocalThreadToReview`, nothing is
 * stored locally; GitHub owns the thread from the start.
 */
export async function addGitHubComment(
	run: ChapterRunRow,
	anchor: GitHubCommentAnchor,
): Promise<void> {
	await withLockedReviewTarget(run, async (target) => {
		const { repo, prNumber, review } = target;
		assertGitHubWritable(run, review);
		if (!anchor.pending && review.pendingReviewNodeId !== null) {
			throw new ReviewError(
				"A pending GitHub review now exists. Refresh to add this comment to it.",
				409,
			);
		}
		const side = toGitHubSide(anchor.side);
		const startLine = anchor.endLine !== anchor.startLine ? anchor.startLine : null;
		if (!anchor.pending) {
			await addImmediateReviewComment(run.repoRoot, repo, prNumber, {
				commitOid: review.headRefOid,
				path: anchor.filePath,
				body: anchor.body,
				line: anchor.endLine,
				side,
				startLine,
				startSide: startLine !== null ? side : null,
			});
			return;
		}
		await withPendingReview(run, target, (reviewNodeId) =>
			addReviewThread(run.repoRoot, {
				pullRequestNodeId: review.pullRequestNodeId,
				reviewNodeId,
				path: anchor.filePath,
				body: anchor.body,
				line: anchor.endLine,
				side,
				startLine,
				startSide: startLine !== null ? side : null,
			}),
		);
	});
}

/** Reply to a GitHub thread, adding to the viewer's pending review (or as a single comment). */
export async function replyToGitHubThread(
	run: ChapterRunRow,
	threadNodeId: string,
	body: string,
	pending: boolean,
): Promise<void> {
	await withLockedReviewTarget(run, async (target) => {
		const { review } = target;
		assertGitHubWritable(run, review);
		const thread = requireReviewThread(review, threadNodeId);
		if (!thread.viewerCanReply) {
			throw new ReviewError("GitHub doesn't allow you to reply to this review thread.", 403);
		}
		if (!pending) {
			if (review.pendingReviewNodeId !== null) {
				throw new ReviewError(
					"A pending GitHub review now exists. Refresh to add this reply to it.",
					409,
				);
			}
			await addReviewReply(run.repoRoot, threadNodeId, body, null);
			return;
		}
		await withPendingReview(run, target, (reviewNodeId) =>
			addReviewReply(run.repoRoot, threadNodeId, body, reviewNodeId),
		);
	});
}

/** Submit the viewer's pending review with the chosen event, opening one if needed (e.g. a bare approval). */
export async function submitRunReview(
	run: ChapterRunRow,
	event: ReviewEvent,
	body: string,
): Promise<void> {
	await withLockedReviewTarget(run, async (target) => {
		const { review } = target;
		assertGitHubWritable(run, review);
		if (review.viewerDidAuthor && event !== REVIEW_EVENT.COMMENT) {
			throw new ReviewError("You can't approve or request changes on your own pull request.", 400);
		}
		if (event === REVIEW_EVENT.REQUEST_CHANGES && body.trim() === "") {
			throw new ReviewError("Add a summary to request changes.", 400);
		}
		if (
			event === REVIEW_EVENT.COMMENT &&
			body.trim() === "" &&
			review.pendingComments.length === 0
		) {
			throw new ReviewError(
				"Add a summary or at least one pending comment to submit a review.",
				400,
			);
		}
		await withPendingReview(run, target, (reviewNodeId) =>
			submitReview(run.repoRoot, review.pullRequestNodeId, reviewNodeId, event, body),
		);
	});
}

/** Discard the viewer's pending review and all its draft comments. */
export async function discardRunReview(run: ChapterRunRow): Promise<void> {
	await withLockedReviewTarget(run, async ({ review }) => {
		if (review.pendingReviewNodeId === null) return;
		if (run.prNumber === null && !runMatchesPrDiff(run, review)) {
			throw new ReviewError(
				"This run isn't tied to the pull request currently discovered for the checkout. Re-run with --pr before discarding its review.",
				409,
			);
		}
		await discardReview(run.repoRoot, review.pendingReviewNodeId);
	});
}

/** Edit a GitHub review comment by node id (used for pending comments). */
export async function editGitHubComment(
	run: ChapterRunRow,
	nodeId: string,
	body: string,
): Promise<void> {
	await withLockedReviewTarget(run, async ({ review }) => {
		assertGitHubWritable(run, review);
		requirePendingComment(review, nodeId);
		await updateReviewComment(run.repoRoot, nodeId, body);
	});
}

/** Delete a pending GitHub review comment by node id. */
export async function deleteGitHubComment(run: ChapterRunRow, nodeId: string): Promise<void> {
	await withLockedReviewTarget(run, async ({ review }) => {
		assertGitHubWritable(run, review);
		requirePendingComment(review, nodeId);
		await deleteReviewComment(run.repoRoot, nodeId);
	});
}

/** Resolve or reopen a GitHub review thread. */
export async function resolveGitHubThread(
	run: ChapterRunRow,
	threadNodeId: string,
	resolved: boolean,
): Promise<void> {
	await withLockedReviewTarget(run, async ({ review }) => {
		assertGitHubWritable(run, review);
		const thread = requireReviewThread(review, threadNodeId);
		const canChangeResolution = resolved ? thread.viewerCanResolve : thread.viewerCanUnresolve;
		if (!canChangeResolution) {
			throw new ReviewError(
				`GitHub doesn't allow you to ${resolved ? "resolve" : "reopen"} this review thread.`,
				403,
			);
		}
		await setThreadResolved(run.repoRoot, threadNodeId, resolved);
	});
}
