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
	addImmediateReviewComment,
	addReviewReply,
	addReviewThread,
	createPendingReview,
	deleteReviewComment,
	discardReview,
	GITHUB_DIFF_SIDE,
	type ReviewThread as GitHubApiReviewThread,
	type GitHubDiffSide,
	type GitHubReview,
	getPromotionThreadState,
	getReview,
	type PromotionThreadState,
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
}

function canWriteToGitHub(run: ChapterRunRow, review: GitHubReview): boolean {
	return review.state === "OPEN" && runMatchesPrDiff(run, review);
}

function canPushToReview(run: ChapterRunRow, review: GitHubReview): boolean {
	return canWriteToGitHub(run, review);
}

function requireReviewThread(review: GitHubReview, threadNodeId: string): GitHubApiReviewThread {
	const thread = review.threads.find((candidate) => candidate.threadNodeId === threadNodeId);
	if (thread) return thread;
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
		startSide: fromGitHubSide(t.startSide ?? t.side),
		startLine: t.startLine ?? endLine,
		endLine,
		isResolved: t.isResolved,
		viewerCanResolve: t.viewerCanResolve,
		viewerCanUnresolve: t.viewerCanUnresolve,
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
	target: ReviewTarget,
	action: (reviewNodeId: string) => Promise<T>,
): Promise<T> {
	const { review } = target;
	const { reviewNodeId, created } = await openPendingReview(run, review);
	try {
		return await action(reviewNodeId);
	} catch (err) {
		if (created) {
			try {
				const current = await getReview(run.repoRoot, target.repo, target.prNumber);
				if (
					current.pendingReviewNodeId === reviewNodeId &&
					current.pendingCommentCount === 0 &&
					current.pendingReviewBody.trim() === ""
				) {
					await discardReview(run.repoRoot, reviewNodeId);
				}
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
			pullRequestNodeId: commentThread.promotionPullRequestNodeId,
			threadNodeId: commentThread.promotionThreadNodeId,
			rootCommentNodeId: commentThread.promotionRootCommentNodeId,
		})
		.from(commentThread)
		.where(eq(commentThread.id, localThreadId))
		.limit(1)
		.all();
	return (
		thread !== undefined &&
		(thread.pullRequestNodeId !== null ||
			thread.threadNodeId !== null ||
			thread.rootCommentNodeId !== null)
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
	let checkpoint = readPromotionCheckpoint(thread);
	let initialReplyCount = thread.promotionReplyCount;
	let initialReplyNodeIds = thread.promotionReplyNodeIds;
	if (
		thread.promotionReplyCount > replies.length ||
		thread.promotionReplyNodeIds.length > replies.length
	) {
		throw new ReviewError(
			"This comment's promotion progress is invalid and cannot be resumed.",
			409,
		);
	}
	const checkpointRemote =
		checkpoint === null
			? null
			: await releaseCrossPullRequestPromotion(db, run, localThreadId, checkpoint);
	// The remote root may have been removed while an account switch was in progress.
	// Release that now-missing checkpoint before binding recovery to its old viewer.
	if (checkpoint !== null && checkpointRemote === null) {
		clearPromotionProgress(db, localThreadId);
		checkpoint = null;
		initialReplyCount = 0;
		initialReplyNodeIds = [];
	}

	await withLockedReviewTarget(run, async ({ review }) => {
		let liveCheckpointRemote = checkpointRemote;
		if (checkpoint !== null) {
			const current = await getPromotionThreadState(run.repoRoot, checkpoint.threadNodeId);
			if (
				current === null ||
				current.pullRequestNodeId !== checkpoint.pullRequestNodeId ||
				current.rootCommentNodeId !== checkpoint.rootCommentNodeId
			) {
				clearPromotionProgress(db, localThreadId);
				checkpoint = null;
				liveCheckpointRemote = null;
				initialReplyCount = 0;
				initialReplyNodeIds = [];
			} else {
				liveCheckpointRemote = current;
			}
		}
		const originatingViewer =
			checkpoint?.viewerLogin ?? liveCheckpointRemote?.rootAuthorLogin ?? null;
		if (originatingViewer !== null && originatingViewer !== review.viewerLogin) {
			throw new ReviewError(
				`This comment promotion belongs to GitHub user ${originatingViewer}. Switch back to that account to resume it.`,
				409,
			);
		}
		if (checkpoint !== null && checkpoint.viewerLogin === null && originatingViewer !== null) {
			db.update(commentThread)
				.set({ promotionViewerLogin: originatingViewer })
				.where(eq(commentThread.id, localThreadId))
				.run();
		}
		try {
			assertPushable(run, review);
			if (checkpoint !== null && checkpoint.pullRequestNodeId !== review.pullRequestNodeId) {
				throw new ReviewError("This comment promotion belongs to another pull request.", 409);
			}
		} catch (error) {
			if (checkpoint !== null) {
				await releasePromotionCheckpoint(db, run, localThreadId, checkpoint);
			}
			throw error;
		}
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

		let addedThread: Pick<AddedReviewThread, "threadNodeId" | "rootCommentNodeId"> | null =
			checkpoint;
		let promotedReplyNodeIds = [...initialReplyNodeIds];
		let promotedReplyCount = initialReplyCount;
		let reviewNodeId: string | null = null;
		let created = false;
		let remoteRootIsPending = false;
		let remoteThreadIsResolved = false;
		let remoteThreadCanResolve = false;
		let rootCreatedThisAttempt = false;
		let rollbackReplyCount = promotedReplyCount;
		let rollbackReplyNodeIds = [...promotedReplyNodeIds];
		try {
			if (addedThread !== null) {
				const remoteThread = review.threads.find(
					(candidate) => candidate.threadNodeId === addedThread?.threadNodeId,
				);
				const persistedRoot = remoteThread?.comments.find(
					(candidate) => candidate.nodeId === addedThread?.rootCommentNodeId,
				);
				// A fresh point lookup above proved the root exists. If the broader
				// review snapshot omitted it, stop instead of creating a duplicate.
				if (!remoteThread || !persistedRoot) {
					throw new ReviewError(
						"The GitHub promotion thread could not be loaded. Refresh and try again.",
						409,
					);
				} else {
					remoteRootIsPending = persistedRoot.isPending;
					remoteThreadIsResolved = remoteThread.isResolved;
					remoteThreadCanResolve = remoteThread.viewerCanResolve;
					promotedReplyNodeIds = reconcilePromotionReplyNodeIds(
						remoteThread,
						review.viewerLogin,
						replies,
						promotedReplyCount,
						promotedReplyNodeIds,
					);
					promotedReplyCount = promotedReplyNodeIds.filter(Boolean).length;
					db.update(commentThread)
						.set({
							promotionReplyCount: promotedReplyCount,
							promotionReplyNodeIds: compactPromotionReplyNodeIds(promotedReplyNodeIds),
						})
						.where(eq(commentThread.id, localThreadId))
						.run();
				}
			}
			rollbackReplyCount = promotedReplyCount;
			rollbackReplyNodeIds = [...promotedReplyNodeIds];

			if (addedThread === null || promotedReplyNodeIds.filter(Boolean).length < replies.length) {
				const pendingReview = await openPendingReview(run, review);
				reviewNodeId = pendingReview.reviewNodeId;
				created = pendingReview.created;
			}
			if (addedThread === null) {
				if (reviewNodeId === null) throw new Error("Pending review was not opened");
				const createdThread = await addReviewThread(run.repoRoot, {
					pullRequestNodeId: review.pullRequestNodeId,
					reviewNodeId,
					path: thread.filePath,
					body: root.body,
					line: thread.endLine,
					side,
					startLine,
					startSide: startLine !== null ? side : null,
				});
				addedThread = createdThread;
				remoteThreadCanResolve = createdThread.viewerCanResolve;
				rootCreatedThisAttempt = true;
				remoteRootIsPending = true;
				const persisted = db
					.update(commentThread)
					.set({
						promotionPullRequestNodeId: review.pullRequestNodeId,
						promotionThreadNodeId: addedThread.threadNodeId,
						promotionRootCommentNodeId: addedThread.rootCommentNodeId,
						promotionViewerLogin: review.viewerLogin,
						promotionReplyCount: 0,
						promotionReplyNodeIds: [],
					})
					.where(eq(commentThread.id, localThreadId))
					.run();
				if (persisted.changes !== 1) throw new Error("Local promotion checkpoint was not saved");
			}
			for (const [index, reply] of replies.entries()) {
				if (promotedReplyNodeIds[index]) continue;
				if (reviewNodeId === null) throw new Error("Pending review was not opened");
				const replyNodeId = await addReviewReply(
					run.repoRoot,
					addedThread.threadNodeId,
					reply.body,
					reviewNodeId,
				);
				promotedReplyNodeIds[index] = replyNodeId;
				promotedReplyCount = promotedReplyNodeIds.filter(Boolean).length;
				const persisted = db
					.update(commentThread)
					.set({
						promotionReplyCount: promotedReplyCount,
						promotionReplyNodeIds: compactPromotionReplyNodeIds(promotedReplyNodeIds),
					})
					.where(eq(commentThread.id, localThreadId))
					.run();
				if (persisted.changes !== 1) throw new Error("Local promotion checkpoint was not saved");
			}
			if (thread.resolvedAt !== null && !remoteThreadIsResolved && remoteThreadCanResolve) {
				await setThreadResolved(run.repoRoot, addedThread.threadNodeId, true);
			}
		} catch (err) {
			// A pending root can be deleted to roll back its whole partial thread. A
			// published root must never be deleted: it may have been submitted on
			// GitHub while this process was interrupted.
			let remoteRootRolledBack = addedThread === null;
			let remoteRootWasPublished = false;
			if (addedThread !== null && remoteRootIsPending) {
				try {
					const current = await getPromotionThreadState(run.repoRoot, addedThread.threadNodeId);
					if (
						current !== null &&
						current.rootCommentNodeId === addedThread.rootCommentNodeId &&
						current.rootIsPending
					) {
						await deleteReviewComment(run.repoRoot, addedThread.rootCommentNodeId);
						remoteRootRolledBack = true;
					} else if (
						current !== null &&
						current.rootCommentNodeId === addedThread.rootCommentNodeId
					) {
						remoteRootWasPublished = true;
					}
				} catch (rollbackError) {
					reportPromotionCleanupFailure("delete partial GitHub promotion", rollbackError);
				}
			}
			if (created && reviewNodeId !== null && !remoteRootWasPublished) {
				try {
					await discardReview(run.repoRoot, reviewNodeId);
					if (rootCreatedThisAttempt) {
						remoteRootRolledBack = true;
					} else if (!remoteRootRolledBack) {
						db.update(commentThread)
							.set({
								promotionReplyCount: rollbackReplyCount,
								promotionReplyNodeIds: compactPromotionReplyNodeIds(rollbackReplyNodeIds),
							})
							.where(eq(commentThread.id, localThreadId))
							.run();
					}
				} catch (discardError) {
					reportPromotionCleanupFailure("discard promotion review", discardError);
				}
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

interface PromotionCheckpoint {
	pullRequestNodeId: string;
	threadNodeId: string;
	rootCommentNodeId: string;
	viewerLogin: string | null;
}

function readPromotionCheckpoint(
	thread: typeof commentThread.$inferSelect,
): PromotionCheckpoint | null {
	const pullRequestNodeId = thread.promotionPullRequestNodeId;
	const threadNodeId = thread.promotionThreadNodeId;
	const rootCommentNodeId = thread.promotionRootCommentNodeId;
	if (pullRequestNodeId === null && threadNodeId === null && rootCommentNodeId === null)
		return null;
	if (pullRequestNodeId === null || threadNodeId === null || rootCommentNodeId === null) {
		throw new ReviewError(
			"This comment has incomplete promotion state and cannot be resumed.",
			409,
		);
	}
	return {
		pullRequestNodeId,
		threadNodeId,
		rootCommentNodeId,
		viewerLogin: thread.promotionViewerLogin,
	};
}

async function releaseCrossPullRequestPromotion(
	db: StageDb,
	run: ChapterRunRow,
	localThreadId: string,
	checkpoint: PromotionCheckpoint,
): Promise<PromotionThreadState | null> {
	const remote = await getPromotionThreadState(run.repoRoot, checkpoint.threadNodeId);
	if (
		remote === null ||
		remote.pullRequestNodeId !== checkpoint.pullRequestNodeId ||
		remote.rootCommentNodeId !== checkpoint.rootCommentNodeId
	) {
		return null;
	}
	const identity = await resolveReviewIdentity(run);
	const sameTarget =
		remote.pullRequestNumber === identity.prNumber &&
		remote.repo.owner.toLowerCase() === identity.repo.owner.toLowerCase() &&
		remote.repo.repo.toLowerCase() === identity.repo.repo.toLowerCase();
	if (sameTarget) return remote;
	let released = false;
	await reviewActions.run(
		{
			kind: REVIEW_ACTION_SCOPE.PULL_REQUEST,
			owner: remote.repo.owner,
			repo: remote.repo.repo,
			prNumber: remote.pullRequestNumber,
		},
		async () => {
			released = await releasePromotionCheckpoint(db, run, localThreadId, checkpoint);
		},
	);
	throw new ReviewError(
		released
			? "This comment promotion belonged to another pull request and was released. Try adding it to this review again."
			: "This comment promotion belongs to another pull request and is already published there.",
		409,
	);
}

async function releasePromotionCheckpoint(
	db: StageDb,
	run: ChapterRunRow,
	localThreadId: string,
	checkpoint: PromotionCheckpoint,
): Promise<boolean> {
	const remote = await getPromotionThreadState(run.repoRoot, checkpoint.threadNodeId);
	if (
		remote !== null &&
		remote.pullRequestNodeId === checkpoint.pullRequestNodeId &&
		remote.rootCommentNodeId === checkpoint.rootCommentNodeId
	) {
		if (!remote.rootIsPending) return false;
		await deleteReviewComment(run.repoRoot, checkpoint.rootCommentNodeId);
	}
	clearPromotionProgress(db, localThreadId);
	return true;
}

function clearPromotionProgress(db: StageDb, localThreadId: string): void {
	db.update(commentThread)
		.set({
			promotionPullRequestNodeId: null,
			promotionThreadNodeId: null,
			promotionRootCommentNodeId: null,
			promotionViewerLogin: null,
			promotionReplyCount: 0,
			promotionReplyNodeIds: [],
		})
		.where(eq(commentThread.id, localThreadId))
		.run();
}

/**
 * Reconcile saved reply ids with the live thread. Older checkpoints have only a
 * count, so their prefix falls back to ordered body matching. Replies that landed
 * immediately before a crash are also found by searching forward, which tolerates
 * unrelated viewer replies without treating them as positional matches.
 */
function reconcilePromotionReplyNodeIds(
	remoteThread: GitHubApiReviewThread,
	viewerLogin: string,
	localReplies: { body: string }[],
	checkpointCount: number,
	checkpointNodeIds: (string | null)[],
): (string | null)[] {
	const remoteReplies = remoteThread.comments.slice(1);
	const reconciled = Array<string | null>(localReplies.length).fill(null);
	const usedRemoteIds = new Set<string>();
	let lastRemoteIndex = -1;

	for (const [index, localReply] of localReplies.entries()) {
		const storedNodeId = checkpointNodeIds[index];
		if (storedNodeId) {
			const remoteIndex = remoteReplies.findIndex((candidate) => candidate.nodeId === storedNodeId);
			if (remoteIndex !== -1) {
				reconciled[index] = storedNodeId;
				usedRemoteIds.add(storedNodeId);
				lastRemoteIndex = Math.max(lastRemoteIndex, remoteIndex);
			}
			// A saved id that disappeared was manually deleted. Do not let a
			// same-body viewer comment impersonate it; this local reply must resend.
			continue;
		}

		const isLegacyCheckpoint = index < checkpointCount;
		const mayHaveLandedBeforeCheckpoint = index >= checkpointNodeIds.length;
		if (!isLegacyCheckpoint && !mayHaveLandedBeforeCheckpoint) continue;
		const remoteIndex = remoteReplies.findIndex(
			(candidate, candidateIndex) =>
				candidateIndex > lastRemoteIndex &&
				!usedRemoteIds.has(candidate.nodeId) &&
				candidate.authorLogin === viewerLogin &&
				candidate.body === localReply.body,
		);
		if (remoteIndex === -1) continue;
		const remoteReply = remoteReplies[remoteIndex];
		if (!remoteReply) continue;
		reconciled[index] = remoteReply.nodeId;
		usedRemoteIds.add(remoteReply.nodeId);
		lastRemoteIndex = remoteIndex;
	}
	return reconciled;
}

function compactPromotionReplyNodeIds(ids: (string | null)[]): (string | null)[] {
	let length = ids.length;
	while (length > 0 && !ids[length - 1]) length--;
	return ids.slice(0, length);
}

function reportPromotionCleanupFailure(action: string, error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`Failed to ${action}: ${message}\n`);
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
		if (anchor.pending) assertGitHubWritable(run, review);
		else {
			assertGitHubWritable(run, review);
			if (review.pendingReviewNodeId !== null) {
				throw new ReviewError(
					"A pending GitHub review now exists. Refresh to add this comment to it.",
					409,
				);
			}
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
		if (pending) assertPushable(run, review);
		else assertGitHubWritable(run, review);
		requireReviewThread(review, threadNodeId);
		if (!pending) {
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
		await withPendingReview(run, target, (reviewNodeId) =>
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
