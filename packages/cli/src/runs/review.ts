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
	type AddedReviewThread,
	addReviewReply,
	addReviewThread,
	createPendingReview,
	deleteReviewComment,
	discardReview,
	GITHUB_DIFF_SIDE,
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

function assertPushable(run: ChapterRunRow, review: GitHubReview): void {
	assertGitHubWritable(run, review);
	if (review.pendingReviewNodeId !== null && review.pendingReviewCommitOid !== review.headRefOid) {
		throw new ReviewError(
			"Your pending GitHub review belongs to an earlier PR version. Submit or discard it on GitHub before commenting on this run.",
			409,
		);
	}
}

function canWriteToGitHub(run: ChapterRunRow, review: GitHubReview): boolean {
	return review.state === "OPEN" && runMatchesPrDiff(run, review);
}

function canPushToReview(run: ChapterRunRow, review: GitHubReview): boolean {
	return (
		canWriteToGitHub(run, review) &&
		(review.pendingReviewNodeId === null || review.pendingReviewCommitOid === review.headRefOid)
	);
}

function requireReviewThread(review: GitHubReview, threadNodeId: string): void {
	if (review.threads.some((thread) => thread.threadNodeId === threadNodeId)) return;
	throw new ReviewError("That GitHub review thread doesn't belong to this pull request.", 400);
}

function requirePendingComment(review: GitHubReview, nodeId: string): void {
	if (review.pendingComments.some((candidate) => candidate.id === nodeId)) return;
	const comment = review.threads
		.flatMap((thread) => thread.comments)
		.find((candidate) => candidate.nodeId === nodeId);
	if (comment?.isPending) return;
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
		startLine: t.startLine ?? endLine,
		endLine,
		isResolved: t.isResolved,
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
		pendingCommentCount: 0,
		hasPendingReview: false,
		pendingReviewBody: "",
		isOwnPullRequest: false,
		canPushToReview: false,
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
			pendingCommentCount: review.pendingCommentCount,
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
		pendingCommentCount: review.pendingCommentCount,
		hasPendingReview: review.pendingReviewNodeId !== null,
		pendingReviewBody: review.pendingReviewBody,
		isOwnPullRequest: review.viewerDidAuthor,
		canPushToReview: canPushToReview(run, review),
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
 * Resolve the PR, acquire its cross-checkout lock, then read fresh review state
 * inside the lock before performing a mutation.
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
async function openPendingReview(
	run: ChapterRunRow,
	review: GitHubReview,
): Promise<{ reviewNodeId: string; created: boolean }> {
	if (review.pendingReviewNodeId !== null) {
		if (review.pendingReviewCommitOid !== review.headRefOid) {
			throw new ReviewError(
				"Your pending GitHub review belongs to an earlier PR version. Submit or discard it on GitHub before commenting on this run.",
				409,
			);
		}
		return { reviewNodeId: review.pendingReviewNodeId, created: false };
	}
	return {
		reviewNodeId: await createPendingReview(
			run.repoRoot,
			review.pullRequestNodeId,
			review.headRefOid,
		),
		created: true,
	};
}

/**
 * Run an action against the viewer's pending review, opening one if needed. If we
 * had to open the review and the action then fails (e.g. an out-of-diff line), the
 * just-created empty review is discarded so it doesn't linger on the PR as a stray
 * "review to submit". A pre-existing review is never discarded.
 */
async function withPendingReview<T>(
	run: ChapterRunRow,
	review: GitHubReview,
	action: (reviewNodeId: string) => Promise<T>,
): Promise<T> {
	const { reviewNodeId, created } = await openPendingReview(run, review);
	try {
		return await action(reviewNodeId);
	} catch (err) {
		if (created) {
			try {
				await discardReview(run.repoRoot, reviewNodeId);
			} catch (discardError) {
				const message = discardError instanceof Error ? discardError.message : String(discardError);
				process.stderr.write(
					`Failed to discard newly created GitHub review after action failure: ${message}\n`,
				);
			}
		}
		throw err;
	}
}

// Queued ids reject duplicate promotion requests immediately. The active set starts
// only after promotion owns the checkout lock, so an earlier local mutation wins.
const queuedPromotions = new Set<string>();
const promotingThreads = new Set<string>();

/** True while the local thread is frozen for an in-flight or interrupted promotion. */
export function isLocalThreadPromoting(db: StageDb, localThreadId: string): boolean {
	if (promotingThreads.has(localThreadId)) return true;
	const [thread] = db
		.select({
			threadNodeId: commentThread.promotionThreadNodeId,
			rootCommentNodeId: commentThread.promotionRootCommentNodeId,
		})
		.from(commentThread)
		.where(eq(commentThread.id, localThreadId))
		.limit(1)
		.all();
	return (
		thread !== undefined && (thread.threadNodeId !== null || thread.rootCommentNodeId !== null)
	);
}

/** True once promotion is queued, active, or interrupted and awaiting recovery. */
export function isLocalThreadPromotionPending(db: StageDb, localThreadId: string): boolean {
	return queuedPromotions.has(localThreadId) || isLocalThreadPromoting(db, localThreadId);
}

/**
 * Promote a local comment thread to the viewer's pending GitHub review: the root
 * becomes a new review thread, replies become pending replies, and the local thread
 * is removed (it now lives on GitHub as pending). GitHub anchors the comment to the
 * PR's current diff, so a line not in that diff is rejected and surfaced as an error.
 */
export async function addLocalThreadToReview(
	db: StageDb,
	run: ChapterRunRow,
	localThreadId: string,
): Promise<void> {
	if (queuedPromotions.has(localThreadId)) {
		throw new ReviewError("This comment is already being added to the review.", 409);
	}
	queuedPromotions.add(localThreadId);
	try {
		await reviewActions.run(
			{ kind: REVIEW_ACTION_SCOPE.CHECKOUT, repoRoot: run.repoRoot },
			async () => {
				promotingThreads.add(localThreadId);
				try {
					await promoteLocalThread(db, run, localThreadId);
				} finally {
					promotingThreads.delete(localThreadId);
				}
			},
		);
	} finally {
		queuedPromotions.delete(localThreadId);
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
	if ((thread.promotionThreadNodeId === null) !== (thread.promotionRootCommentNodeId === null)) {
		throw new ReviewError(
			"This comment has incomplete promotion state and cannot be resumed.",
			409,
		);
	}
	if (thread.promotionReplyCount > replies.length) {
		throw new ReviewError(
			"This comment's promotion progress is invalid and cannot be resumed.",
			409,
		);
	}

	await withLockedReviewTarget(run, async ({ review }) => {
		assertPushable(run, review);
		const side = toGitHubSide(thread.side);
		const startLine = thread.endLine !== thread.startLine ? thread.startLine : null;
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

		let addedThread: AddedReviewThread | null =
			thread.promotionThreadNodeId !== null && thread.promotionRootCommentNodeId !== null
				? {
						threadNodeId: thread.promotionThreadNodeId,
						rootCommentNodeId: thread.promotionRootCommentNodeId,
					}
				: null;
		let promotedReplyCount = thread.promotionReplyCount;
		let reviewNodeId: string | null = null;
		let created = false;
		let remoteRootIsPending = false;
		let remoteThreadIsResolved = false;
		let rootCreatedThisAttempt = false;
		let rollbackReplyCount = promotedReplyCount;
		try {
			if (addedThread !== null) {
				const remoteThread = review.threads.find(
					(candidate) => candidate.threadNodeId === addedThread?.threadNodeId,
				);
				const persistedRoot = remoteThread?.comments.find(
					(candidate) => candidate.nodeId === addedThread?.rootCommentNodeId,
				);
				// If the persisted remote root was removed manually, restart cleanly.
				if (!remoteThread || !persistedRoot) {
					clearPromotionProgress(db, localThreadId);
					addedThread = null;
					promotedReplyCount = 0;
				} else {
					remoteRootIsPending = persistedRoot.isPending;
					remoteThreadIsResolved = remoteThread.isResolved;
					// A crash can land a reply immediately before its local checkpoint.
					// Reconcile only replies authored by this viewer before sending
					// anything again; another participant may have posted the same body.
					while (
						promotedReplyCount < replies.length &&
						remoteThread.comments[promotedReplyCount + 1]?.authorLogin === review.viewerLogin &&
						remoteThread.comments[promotedReplyCount + 1]?.body ===
							replies[promotedReplyCount]?.body
					) {
						promotedReplyCount++;
					}
					db.update(commentThread)
						.set({ promotionReplyCount: promotedReplyCount })
						.where(eq(commentThread.id, localThreadId))
						.run();
				}
			}
			rollbackReplyCount = promotedReplyCount;

			if (addedThread === null || promotedReplyCount < replies.length) {
				const pendingReview = await openPendingReview(run, review);
				reviewNodeId = pendingReview.reviewNodeId;
				created = pendingReview.created;
			}
			if (addedThread === null) {
				if (reviewNodeId === null) throw new Error("Pending review was not opened");
				addedThread = await addReviewThread(run.repoRoot, {
					pullRequestNodeId: review.pullRequestNodeId,
					reviewNodeId,
					path: thread.filePath,
					body: root.body,
					line: thread.endLine,
					side,
					startLine,
					startSide: startLine !== null ? side : null,
				});
				rootCreatedThisAttempt = true;
				remoteRootIsPending = true;
				const persisted = db
					.update(commentThread)
					.set({
						promotionThreadNodeId: addedThread.threadNodeId,
						promotionRootCommentNodeId: addedThread.rootCommentNodeId,
						promotionReplyCount: 0,
					})
					.where(eq(commentThread.id, localThreadId))
					.run();
				if (persisted.changes !== 1) throw new Error("Local promotion checkpoint was not saved");
			}
			for (const [index, reply] of replies.entries()) {
				if (index < promotedReplyCount) continue;
				if (reviewNodeId === null) throw new Error("Pending review was not opened");
				await addReviewReply(run.repoRoot, addedThread.threadNodeId, reply.body, reviewNodeId);
				const persisted = db
					.update(commentThread)
					.set({ promotionReplyCount: index + 1 })
					.where(eq(commentThread.id, localThreadId))
					.run();
				if (persisted.changes !== 1) throw new Error("Local promotion checkpoint was not saved");
			}
			if (thread.resolvedAt !== null && !remoteThreadIsResolved) {
				await setThreadResolved(run.repoRoot, addedThread.threadNodeId, true);
			}
		} catch (err) {
			// A pending root can be deleted to roll back its whole partial thread. A
			// published root must never be deleted: it may have been submitted on
			// GitHub while this process was interrupted.
			let remoteRootRolledBack = addedThread === null;
			if (addedThread !== null && remoteRootIsPending) {
				try {
					await deleteReviewComment(run.repoRoot, addedThread.rootCommentNodeId);
					remoteRootRolledBack = true;
				} catch {}
			}
			if (created && reviewNodeId !== null) {
				try {
					await discardReview(run.repoRoot, reviewNodeId);
					if (rootCreatedThisAttempt) {
						remoteRootRolledBack = true;
					} else if (!remoteRootRolledBack) {
						db.update(commentThread)
							.set({ promotionReplyCount: rollbackReplyCount })
							.where(eq(commentThread.id, localThreadId))
							.run();
					}
				} catch {}
			}
			if (remoteRootRolledBack) clearPromotionProgress(db, localThreadId);
			if (wasUnassigned && remoteRootRolledBack) {
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

function clearPromotionProgress(db: StageDb, localThreadId: string): void {
	db.update(commentThread)
		.set({
			promotionThreadNodeId: null,
			promotionRootCommentNodeId: null,
			promotionReplyCount: 0,
		})
		.where(eq(commentThread.id, localThreadId))
		.run();
}

export interface PendingCommentAnchor {
	filePath: string;
	side: DiffSide;
	startLine: number;
	endLine: number;
	body: string;
}

/**
 * Create a comment directly on the PR as a pending (draft) review comment, opening
 * the viewer's review if needed. This is the "Comment on the PR" path — unlike
 * `addLocalThreadToReview`, nothing is stored locally; the comment lives only on
 * GitHub. GitHub anchors it to the PR's current diff, rejecting out-of-diff lines.
 */
export async function addPendingComment(
	run: ChapterRunRow,
	anchor: PendingCommentAnchor,
): Promise<void> {
	await withLockedReviewTarget(run, async ({ review }) => {
		assertPushable(run, review);
		const side = toGitHubSide(anchor.side);
		const startLine = anchor.endLine !== anchor.startLine ? anchor.startLine : null;
		await withPendingReview(run, review, (reviewNodeId) =>
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
	await withLockedReviewTarget(run, async ({ review }) => {
		if (pending) assertPushable(run, review);
		else assertGitHubWritable(run, review);
		requireReviewThread(review, threadNodeId);
		if (!pending) {
			await addReviewReply(run.repoRoot, threadNodeId, body, null);
			return;
		}
		await withPendingReview(run, review, (reviewNodeId) =>
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
	await withLockedReviewTarget(run, async ({ review }) => {
		assertPushable(run, review);
		if (review.viewerDidAuthor && event !== REVIEW_EVENT.COMMENT) {
			throw new ReviewError("You can't approve or request changes on your own pull request.", 400);
		}
		if (event === REVIEW_EVENT.REQUEST_CHANGES && body.trim() === "") {
			throw new ReviewError("Add a summary to request changes.", 400);
		}
		if (event === REVIEW_EVENT.COMMENT && body.trim() === "" && review.pendingCommentCount === 0) {
			throw new ReviewError(
				"Add a summary or at least one pending comment to submit a review.",
				400,
			);
		}
		await withPendingReview(run, review, (reviewNodeId) =>
			submitReview(run.repoRoot, review.pullRequestNodeId, reviewNodeId, event, body),
		);
	});
}

/** Discard the viewer's pending review and all its draft comments. */
export async function discardRunReview(run: ChapterRunRow): Promise<void> {
	await withLockedReviewTarget(run, async ({ review }) => {
		if (run.prNumber === null && !runMatchesPrDiff(run, review)) {
			throw new ReviewError(
				"This run isn't tied to the pull request currently discovered for the checkout. Re-run with --pr before discarding its review.",
				409,
			);
		}
		if (review.pendingReviewNodeId === null) {
			throw new ReviewError("There's no pending review to discard.", 409);
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
		assertPushable(run, review);
		requirePendingComment(review, nodeId);
		await updateReviewComment(run.repoRoot, nodeId, body);
	});
}

/** Delete a pending GitHub review comment by node id. */
export async function deleteGitHubComment(run: ChapterRunRow, nodeId: string): Promise<void> {
	await withLockedReviewTarget(run, async ({ review }) => {
		assertPushable(run, review);
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
		requireReviewThread(review, threadNodeId);
		await setThreadResolved(run.repoRoot, threadNodeId, resolved);
	});
}
