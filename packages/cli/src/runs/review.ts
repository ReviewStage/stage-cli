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
	type ReviewComment as GitHubApiReviewComment,
	type ReviewThread as GitHubApiReviewThread,
	type GitHubDiffSide,
	type GitHubReview,
	getPromotionThreadState,
	getReview,
	hasSubmittedReviewMarker,
	type PromotionThreadState,
	type ReviewRecoveryThread,
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
			hasPromotionRecovery: hasPromotionRecoveryState(thread),
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
				body: visibleGitHubCommentBody(c.body),
				bodyHtml: c.bodyHtml,
				author: { login: c.authorLogin, avatarUrl: c.authorAvatarUrl || null },
				nodeId: c.nodeId,
				htmlUrl: c.htmlUrl,
				createdAt: c.createdAt,
			}),
		),
	};
}

const COMMENT_RECOVERY_MARKER_PATTERN =
	/\n\n(<!-- stagereview-(?:promotion:[^\r\n]*|promotion-reply [^\r\n]*|direct-comment [^\r\n]*|direct-reply [^\r\n]*) -->)$/;

function visibleGitHubCommentBody(body: string): string {
	return body.replace(COMMENT_RECOVERY_MARKER_PATTERN, "");
}

function preserveGitHubCommentMarker(body: string, originalBody: string): string {
	const marker = originalBody.match(COMMENT_RECOVERY_MARKER_PATTERN)?.[1];
	return marker ? `${body}\n\n${marker}` : body;
}

function visiblePendingComments(comments: GitHubReview["pendingComments"]) {
	return comments.map((comment) => ({
		...comment,
		body: visibleGitHubCommentBody(comment.body),
	}));
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
			pendingComments: visiblePendingComments(review.pendingComments),
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
		pendingComments: visiblePendingComments(review.pendingComments),
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

/** Whether any durable promotion intent or checkpoint survives on the thread row. */
export function hasPromotionRecoveryState(thread: {
	promotionPullRequestNodeId: string | null;
	promotionThreadNodeId: string | null;
	promotionRootCommentNodeId: string | null;
}): boolean {
	return (
		thread.promotionPullRequestNodeId !== null ||
		thread.promotionThreadNodeId !== null ||
		thread.promotionRootCommentNodeId !== null
	);
}

/** Owns the complete queued -> active -> durable-checkpoint promotion lifecycle. */
class PromotionCoordinator {
	readonly #queued = new Set<string>();
	readonly #active = new Set<string>();

	isPromoting(db: StageDb, localThreadId: string): boolean {
		if (this.#active.has(localThreadId)) return true;
		const state = this.#promotionState(db, localThreadId);
		return state !== undefined && !state.promotionRootPublished && hasPromotionRecoveryState(state);
	}

	isPending(db: StageDb, localThreadId: string): boolean {
		return this.isInFlight(localThreadId) || this.isPromoting(db, localThreadId);
	}

	isInFlight(localThreadId: string): boolean {
		return this.#queued.has(localThreadId) || this.#active.has(localThreadId);
	}

	hasCheckpoint(db: StageDb, localThreadId: string): boolean {
		const state = this.#promotionState(db, localThreadId);
		return state !== undefined && hasPromotionRecoveryState(state);
	}

	#promotionState(db: StageDb, localThreadId: string) {
		const [thread] = db
			.select({
				promotionPullRequestNodeId: commentThread.promotionPullRequestNodeId,
				promotionThreadNodeId: commentThread.promotionThreadNodeId,
				promotionRootCommentNodeId: commentThread.promotionRootCommentNodeId,
				promotionRootPublished: commentThread.promotionRootPublished,
			})
			.from(commentThread)
			.where(eq(commentThread.id, localThreadId))
			.limit(1)
			.all();
		return thread;
	}

	async isCommentFrozen(db: StageDb, localThreadId: string, commentId: string): Promise<boolean> {
		if (this.isInFlight(localThreadId)) return true;
		const [thread] = db
			.select()
			.from(commentThread)
			.where(eq(commentThread.id, localThreadId))
			.limit(1)
			.all();
		if (!thread) return false;
		if (readPromotionIntent(thread) !== null) return true;
		const checkpoint = readPromotionCheckpoint(thread);
		if (checkpoint === null) return false;

		const localComments = db
			.select({ id: comment.id, body: comment.body })
			.from(comment)
			.where(eq(comment.threadId, localThreadId))
			.orderBy(asc(comment.createdAt), asc(commentInsertionOrder))
			.all();
		const commentIndex = localComments.findIndex((candidate) => candidate.id === commentId);
		if (commentIndex === -1) return false;
		if (commentIndex > 0) {
			const replyIndex = commentIndex - 1;
			const storedNodeId = thread.promotionReplyNodeIds[replyIndex];
			const isLegacyCheckpoint = replyIndex < thread.promotionReplyCount;
			const isSparseCheckpointSlot = replyIndex < thread.promotionReplyNodeIds.length;
			const uncertainReplyIndex = Math.max(
				thread.promotionReplyCount,
				thread.promotionReplyNodeIds.length,
			);
			// Any saved positional slot and the single next uncertain reply require a
			// live check. Later unsaved replies cannot have been attempted yet.
			if (
				!storedNodeId &&
				!isLegacyCheckpoint &&
				!isSparseCheckpointSlot &&
				replyIndex !== uncertainReplyIndex
			) {
				return false;
			}
		}

		const remote = await getPromotionThreadState(thread.repoRoot, checkpoint.threadNodeId);
		if (!checkpointMatchesRemote(remote, checkpoint)) return false;
		if (!remote.rootIsPending) {
			markPromotionRootPublished(db, localThreadId);
		}
		if (commentIndex === 0) return true;
		const review = await getReview(thread.repoRoot, remote.repo, remote.pullRequestNumber);
		const remoteThread = review.recoveryThreads.find(
			(candidate) => candidate.threadNodeId === checkpoint.threadNodeId,
		);
		const viewerLogin = checkpoint.viewerLogin ?? remote.rootAuthorLogin;
		if (!remoteThread || viewerLogin === null || review.viewerLogin !== viewerLogin) return true;
		const reconciled = reconcilePromotionReplyNodeIds(
			remoteThread,
			viewerLogin,
			localThreadId,
			localComments.slice(1),
			thread.promotionReplyCount,
			thread.promotionReplyNodeIds,
		);
		return reconciled[commentIndex - 1] !== null;
	}

	async add(db: StageDb, run: ChapterRunRow, localThreadId: string): Promise<void> {
		if (this.#queued.has(localThreadId)) {
			throw new ReviewError("This comment is already being added to the review.", 409);
		}
		this.#queued.add(localThreadId);
		try {
			await reviewActions.run(
				{ kind: REVIEW_ACTION_SCOPE.LOCAL_THREAD, threadId: localThreadId },
				async () => {
					this.#active.add(localThreadId);
					try {
						await promoteLocalThread(db, run, localThreadId);
					} finally {
						this.#active.delete(localThreadId);
					}
				},
			);
		} finally {
			this.#queued.delete(localThreadId);
		}
	}
}

const promotionCoordinator = new PromotionCoordinator();

/** True while the local thread is frozen for an in-flight or interrupted promotion. */
export function isLocalThreadPromoting(db: StageDb, localThreadId: string): boolean {
	return promotionCoordinator.isPromoting(db, localThreadId);
}

/** True once promotion is queued, active, or interrupted and awaiting recovery. */
export function isLocalThreadPromotionPending(db: StageDb, localThreadId: string): boolean {
	return promotionCoordinator.isPending(db, localThreadId);
}

/** True only for a promotion queued or running in this process. */
export function isLocalThreadPromotionInFlight(localThreadId: string): boolean {
	return promotionCoordinator.isInFlight(localThreadId);
}

/** True while a local thread retains any recoverable remote promotion identity. */
export function hasLocalThreadPromotionCheckpoint(db: StageDb, localThreadId: string): boolean {
	return promotionCoordinator.hasCheckpoint(db, localThreadId);
}

/** Whether a local comment is already remote or could be landing during promotion. */
export function isLocalCommentPromotionPending(
	db: StageDb,
	localThreadId: string,
	commentId: string,
): Promise<boolean> {
	return promotionCoordinator.isCommentFrozen(db, localThreadId, commentId);
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
	await promotionCoordinator.add(db, run, localThreadId);
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
	let intent = readPromotionIntent(thread);
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

	await withLockedReviewTarget(run, async (target) => {
		const { review } = target;
		const side = toGitHubSide(thread.side);
		const startLine = thread.endLine !== thread.startLine ? thread.startLine : null;
		let recoveredFromIntent = false;
		let liveCheckpointRemote = checkpointRemote;
		if (intent !== null) {
			if (intent.viewerLogin !== null && intent.viewerLogin !== review.viewerLogin) {
				throw promotionViewerMismatchError(intent.viewerLogin);
			}
			if (intent.pullRequestNodeId !== review.pullRequestNodeId) {
				throw new ReviewError("This comment promotion belongs to another pull request.", 409);
			}
			const recoveredThread = findPromotionIntentThread(
				review,
				thread,
				localThreadId,
				intent.baselineThreadNodeIds,
				side,
				startLine,
			);
			if (recoveredThread !== null) {
				const recoveredRoot = recoveredThread.comments[0];
				if (!recoveredRoot) {
					throw new ReviewError("The GitHub promotion thread has no root comment.", 409);
				}
				checkpoint = {
					pullRequestNodeId: intent.pullRequestNodeId,
					threadNodeId: recoveredThread.threadNodeId,
					rootCommentNodeId: recoveredRoot.nodeId,
					viewerLogin: intent.viewerLogin ?? review.viewerLogin,
				};
				const persisted = db
					.update(commentThread)
					.set({
						promotionThreadNodeId: checkpoint.threadNodeId,
						promotionRootCommentNodeId: checkpoint.rootCommentNodeId,
						promotionViewerLogin: checkpoint.viewerLogin,
					})
					.where(eq(commentThread.id, localThreadId))
					.run();
				if (persisted.changes !== 1) {
					throw new Error("Local promotion checkpoint was not saved");
				}
				liveCheckpointRemote = {
					repo: target.repo,
					pullRequestNodeId: checkpoint.pullRequestNodeId,
					pullRequestNumber: target.prNumber,
					rootCommentNodeId: checkpoint.rootCommentNodeId,
					rootAuthorLogin: recoveredRoot.authorLogin,
					rootIsPending: recoveredRoot.isPending,
				};
				recoveredFromIntent = true;
				intent = null;
			}
		}
		// A pending thread owned by another account can be invisible to this viewer.
		// Enforce the durable identity before treating a null point lookup as deletion.
		if (checkpoint?.viewerLogin && checkpoint.viewerLogin !== review.viewerLogin) {
			throw promotionViewerMismatchError(checkpoint.viewerLogin);
		}
		if (checkpoint !== null) {
			const current = recoveredFromIntent
				? liveCheckpointRemote
				: await getPromotionThreadState(run.repoRoot, checkpoint.threadNodeId);
			if (!checkpointMatchesRemote(current, checkpoint)) {
				clearPromotionProgress(db, localThreadId);
				checkpoint = null;
				liveCheckpointRemote = null;
				initialReplyCount = 0;
				initialReplyNodeIds = [];
			} else {
				liveCheckpointRemote = current;
				if (!current.rootIsPending) markPromotionRootPublished(db, localThreadId);
			}
		}
		const originatingViewer =
			checkpoint?.viewerLogin ?? liveCheckpointRemote?.rootAuthorLogin ?? null;
		if (originatingViewer !== null && originatingViewer !== review.viewerLogin) {
			throw promotionViewerMismatchError(originatingViewer);
		}
		if (checkpoint !== null && checkpoint.viewerLogin === null && originatingViewer !== null) {
			db.update(commentThread)
				.set({ promotionViewerLogin: originatingViewer })
				.where(eq(commentThread.id, localThreadId))
				.run();
		}
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
		let reviewNodeId: string | null = null;
		let remoteThreadIsResolved = false;
		let remoteThreadCanResolve = false;
		let remoteThreadCanUnresolve = false;
		try {
			if (addedThread !== null) {
				const remoteThread = review.recoveryThreads.find(
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
					remoteThreadIsResolved = remoteThread.isResolved;
					remoteThreadCanResolve = remoteThread.viewerCanResolve;
					remoteThreadCanUnresolve = remoteThread.viewerCanUnresolve;
					promotedReplyNodeIds = reconcilePromotionReplyNodeIds(
						remoteThread,
						review.viewerLogin,
						localThreadId,
						replies,
						initialReplyCount,
						promotedReplyNodeIds,
					);
					db.update(commentThread)
						.set({
							promotionReplyCount: 0,
							promotionReplyNodeIds: compactPromotionReplyNodeIds(promotedReplyNodeIds),
						})
						.where(eq(commentThread.id, localThreadId))
						.run();
				}
			}
			const shouldResolve = thread.resolvedAt !== null;
			const needsCommentWrite =
				addedThread === null || promotedReplyNodeIds.filter(Boolean).length < replies.length;
			const needsResolutionWrite = addedThread !== null && shouldResolve !== remoteThreadIsResolved;
			if (!needsCommentWrite && !needsResolutionWrite) {
				db.delete(commentThread).where(eq(commentThread.id, localThreadId)).run();
				return;
			}
			try {
				const checkpointThread =
					checkpoint === null
						? null
						: review.recoveryThreads.find(
								(candidate) => candidate.threadNodeId === checkpoint?.threadNodeId,
							);
				// An anchorless checkpoint can finish against a moved diff, but every
				// remaining remote write still requires an open pull request.
				if (checkpoint !== null && checkpointThread?.line === null) {
					if (review.state !== "OPEN") {
						throw new ReviewError("This pull request is closed, so its review is read-only.", 409);
					}
				} else {
					assertPushable(run, review);
				}
				if (checkpoint !== null && checkpoint.pullRequestNodeId !== review.pullRequestNodeId) {
					throw new ReviewError("This comment promotion belongs to another pull request.", 409);
				}
			} catch (error) {
				if (checkpoint !== null) {
					await releasePromotionCheckpoint(db, run, localThreadId, checkpoint);
				}
				throw error;
			}
			if (addedThread === null || promotedReplyNodeIds.filter(Boolean).length < replies.length) {
				reviewNodeId = await openPendingReview(run, review);
			}
			if (addedThread === null) {
				if (reviewNodeId === null) throw new Error("Pending review was not opened");
				if (intent === null) {
					const baselineThreadNodeIds = review.threads.map((candidate) => candidate.threadNodeId);
					const persisted = db
						.update(commentThread)
						.set({
							promotionPullRequestNodeId: review.pullRequestNodeId,
							promotionViewerLogin: review.viewerLogin,
							promotionRootBaselineThreadNodeIds: baselineThreadNodeIds,
						})
						.where(eq(commentThread.id, localThreadId))
						.run();
					if (persisted.changes !== 1) {
						throw new Error("Local promotion intent was not saved");
					}
					intent = {
						pullRequestNodeId: review.pullRequestNodeId,
						viewerLogin: review.viewerLogin,
						baselineThreadNodeIds,
					};
				}
				const activeIntent = intent;
				let createdThread: AddedReviewThread;
				try {
					createdThread = await addReviewThread(run.repoRoot, {
						pullRequestNodeId: review.pullRequestNodeId,
						reviewNodeId,
						path: thread.filePath,
						body: promotionRootBody(root.body, localThreadId),
						line: thread.endLine,
						side,
						startLine,
						startSide: startLine !== null ? side : null,
					});
				} catch (error) {
					const refreshedReview = await getReview(run.repoRoot, target.repo, target.prNumber);
					const uncertainRoot = findPromotionIntentThread(
						refreshedReview,
						thread,
						localThreadId,
						activeIntent.baselineThreadNodeIds,
						side,
						startLine,
					);
					if (uncertainRoot === null) {
						clearPromotionProgress(db, localThreadId);
						intent = null;
					}
					throw error;
				}
				addedThread = createdThread;
				remoteThreadCanResolve = createdThread.viewerCanResolve;
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
					promotionReplyBody(reply.body, localThreadId, reply.id),
					reviewNodeId,
				);
				promotedReplyNodeIds[index] = replyNodeId;
				const persisted = db
					.update(commentThread)
					.set({
						promotionReplyCount: 0,
						promotionReplyNodeIds: compactPromotionReplyNodeIds(promotedReplyNodeIds),
					})
					.where(eq(commentThread.id, localThreadId))
					.run();
				if (persisted.changes !== 1) throw new Error("Local promotion checkpoint was not saved");
			}
			if (shouldResolve !== remoteThreadIsResolved) {
				const canChangeResolution = shouldResolve
					? remoteThreadCanResolve
					: remoteThreadCanUnresolve;
				if (!canChangeResolution) {
					throw new ReviewError(
						`GitHub doesn't allow you to ${shouldResolve ? "resolve" : "reopen"} this promoted review thread.`,
						403,
					);
				}
				await setThreadResolved(run.repoRoot, addedThread.threadNodeId, shouldResolve);
			}
		} catch (err) {
			// GitHub does not offer a conditional delete for a review root or review.
			// Once a root exists, retain its checkpoint so a retry can reconcile it
			// without racing and deleting concurrent GitHub work.
			if (wasUnassigned && addedThread === null && intent === null && checkpoint === null) {
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

/** Whether the live GitHub thread still is the one this checkpoint was written for. */
function checkpointMatchesRemote(
	remote: PromotionThreadState | null,
	checkpoint: PromotionCheckpoint,
): remote is PromotionThreadState {
	return (
		remote !== null &&
		remote.pullRequestNodeId === checkpoint.pullRequestNodeId &&
		remote.rootCommentNodeId === checkpoint.rootCommentNodeId
	);
}

function promotionViewerMismatchError(viewerLogin: string): ReviewError {
	return new ReviewError(
		`This comment promotion belongs to GitHub user ${viewerLogin}. Switch back to that account to resume it.`,
		409,
	);
}

interface PromotionIntent {
	pullRequestNodeId: string;
	viewerLogin: string | null;
	baselineThreadNodeIds: string[] | null;
}

function readPromotionIntent(thread: typeof commentThread.$inferSelect): PromotionIntent | null {
	if (
		thread.promotionPullRequestNodeId === null ||
		thread.promotionThreadNodeId !== null ||
		thread.promotionRootCommentNodeId !== null
	) {
		return null;
	}
	if (thread.promotionReplyCount !== 0 || thread.promotionReplyNodeIds.length !== 0) {
		throw new ReviewError(
			"This comment has incomplete promotion state and cannot be resumed.",
			409,
		);
	}
	return {
		pullRequestNodeId: thread.promotionPullRequestNodeId,
		viewerLogin: thread.promotionViewerLogin,
		baselineThreadNodeIds: thread.promotionRootBaselineThreadNodeIds,
	};
}

function readPromotionCheckpoint(
	thread: typeof commentThread.$inferSelect,
): PromotionCheckpoint | null {
	const pullRequestNodeId = thread.promotionPullRequestNodeId;
	const threadNodeId = thread.promotionThreadNodeId;
	const rootCommentNodeId = thread.promotionRootCommentNodeId;
	if (threadNodeId === null && rootCommentNodeId === null) return null;
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

function promotionRootMarker(localThreadId: string): string {
	return `<!-- stagereview-promotion:${localThreadId} -->`;
}

function promotionRootBody(body: string, localThreadId: string): string {
	return `${body}\n\n${promotionRootMarker(localThreadId)}`;
}

function promotionReplyMarker(localThreadId: string, localReplyId: string): string {
	return `<!-- stagereview-promotion-reply ${JSON.stringify([localThreadId, localReplyId])} -->`;
}

function promotionReplyBody(body: string, localThreadId: string, localReplyId: string): string {
	return `${body}\n\n${promotionReplyMarker(localThreadId, localReplyId)}`;
}

function findPromotionIntentThread(
	review: GitHubReview,
	thread: typeof commentThread.$inferSelect,
	localThreadId: string,
	baselineThreadNodeIds: string[] | null,
	side: GitHubDiffSide,
	startLine: number | null,
): ReviewRecoveryThread | null {
	const marker = promotionRootMarker(localThreadId);
	const markerMatches = review.recoveryThreads.filter((candidate) => {
		const root = candidate.comments[0];
		return root?.authorLogin === review.viewerLogin && root.body.includes(marker);
	});
	if (markerMatches.length > 1) {
		throw new ReviewError(
			"More than one GitHub thread matches this interrupted comment promotion.",
			409,
		);
	}
	const markerMatch = markerMatches[0];
	if (markerMatch) return markerMatch;
	const anchoredMatches = review.threads.filter((candidate) => {
		const root = candidate.comments[0];
		return (
			candidate.path === thread.filePath &&
			candidate.line === thread.endLine &&
			candidate.side === side &&
			candidate.startLine === startLine &&
			candidate.startSide === (startLine === null ? null : side) &&
			root?.authorLogin === review.viewerLogin
		);
	});
	if (baselineThreadNodeIds === null) return null;
	const baseline = new Set(baselineThreadNodeIds);
	const newMatches = anchoredMatches.filter((candidate) => !baseline.has(candidate.threadNodeId));
	if (newMatches.length > 0) {
		throw new ReviewError(
			"A new unmarked GitHub thread matches this interrupted comment promotion. Restore its Stage recovery marker or remove it before retrying.",
			409,
		);
	}
	return null;
}

async function releaseCrossPullRequestPromotion(
	db: StageDb,
	run: ChapterRunRow,
	localThreadId: string,
	checkpoint: PromotionCheckpoint,
): Promise<PromotionThreadState | null> {
	const remote = await getPromotionThreadState(run.repoRoot, checkpoint.threadNodeId);
	if (!checkpointMatchesRemote(remote, checkpoint)) return null;
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
			: "This comment promotion belongs to another pull request and remains associated with it.",
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
	if (checkpointMatchesRemote(remote, checkpoint)) {
		if (!remote.rootIsPending) {
			markPromotionRootPublished(db, localThreadId);
		}
		return false;
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
			promotionRootBaselineThreadNodeIds: null,
			promotionRootPublished: false,
			promotionReplyCount: 0,
			promotionReplyNodeIds: [],
		})
		.where(eq(commentThread.id, localThreadId))
		.run();
}

function markPromotionRootPublished(db: StageDb, localThreadId: string): void {
	db.update(commentThread)
		.set({ promotionRootPublished: true })
		.where(eq(commentThread.id, localThreadId))
		.run();
}

/**
 * Reconcile saved reply ids with the live thread. New writes carry a deterministic
 * marker so an ambiguous success can be recovered exactly. Older checkpoints have
 * only a count, so their prefix and single next uncertain reply fall back to ordered
 * body matching.
 */
function reconcilePromotionReplyNodeIds(
	remoteThread: ReviewRecoveryThread,
	viewerLogin: string,
	localThreadId: string,
	localReplies: { id: string; body: string }[],
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

		const marker = promotionReplyMarker(localThreadId, localReply.id);
		let markedRemoteReply: (typeof remoteReplies)[number] | null = null;
		let markedRemoteIndex = -1;
		for (const [candidateIndex, candidate] of remoteReplies.entries()) {
			if (
				usedRemoteIds.has(candidate.nodeId) ||
				candidate.authorLogin !== viewerLogin ||
				!candidate.body.includes(marker)
			) {
				continue;
			}
			if (markedRemoteReply !== null) {
				throw new ReviewError(
					"More than one GitHub reply matches this interrupted comment promotion.",
					409,
				);
			}
			markedRemoteReply = candidate;
			markedRemoteIndex = candidateIndex;
		}
		if (markedRemoteReply !== null) {
			reconciled[index] = markedRemoteReply.nodeId;
			usedRemoteIds.add(markedRemoteReply.nodeId);
			lastRemoteIndex = Math.max(lastRemoteIndex, markedRemoteIndex);
			continue;
		}

		const isLegacyCheckpoint = index < checkpointCount;
		const checkpointedPrefixLength = Math.max(checkpointCount, checkpointNodeIds.length);
		const mayHaveLandedBeforeCheckpoint = index === checkpointedPrefixLength;
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

export function compactPromotionReplyNodeIds(ids: (string | null)[]): (string | null)[] {
	let length = ids.length;
	while (length > 0 && !ids[length - 1]) length--;
	return ids.slice(0, length);
}

export interface GitHubCommentAnchor {
	creationId: string;
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
		const markedBody = directCommentBody(anchor.body, anchor.creationId);
		const recovered = findDirectComment(review, anchor.creationId);
		if (recovered !== null) {
			const root = recovered.comments[0];
			if (!root) throw new Error("Recovered GitHub thread has no root comment");
			if (root.body !== markedBody) {
				assertGitHubWritable(run, review);
				await updateReviewComment(run.repoRoot, root.nodeId, markedBody);
			}
			return;
		}
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
				body: markedBody,
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
				body: markedBody,
				line: anchor.endLine,
				side,
				startLine,
				startSide: startLine !== null ? side : null,
			}),
		);
	});
}

function directCommentMarker(creationId: string): string {
	return `<!-- stagereview-direct-comment ${JSON.stringify(creationId)} -->`;
}

function directCommentBody(body: string, creationId: string): string {
	return `${body}\n\n${directCommentMarker(creationId)}`;
}

function findDirectComment(review: GitHubReview, creationId: string): ReviewRecoveryThread | null {
	const marker = directCommentMarker(creationId);
	const matches = review.recoveryThreads.filter((thread) => {
		const root = thread.comments[0];
		return root?.authorLogin === review.viewerLogin && root.body.includes(marker);
	});
	if (matches.length > 1) {
		throw new ReviewError("More than one GitHub thread matches this comment creation.", 409);
	}
	return matches[0] ?? null;
}

/** Reply to a GitHub thread, adding to the viewer's pending review (or as a single comment). */
export async function replyToGitHubThread(
	run: ChapterRunRow,
	threadNodeId: string,
	body: string,
	pending: boolean,
	creationId: string,
): Promise<void> {
	await withLockedReviewTarget(run, async (target) => {
		const { review } = target;
		if (pending) assertPushable(run, review);
		else assertGitHubWritable(run, review);
		const thread = requireReviewThread(review, threadNodeId);
		if (!thread.viewerCanReply) {
			throw new ReviewError("GitHub doesn't allow you to reply to this review thread.", 403);
		}
		const markedBody = directReplyBody(body, creationId);
		const recovered = findDirectReply(thread, review.viewerLogin, creationId);
		if (recovered !== null) {
			if (recovered.body !== markedBody) {
				await updateReviewComment(run.repoRoot, recovered.nodeId, markedBody);
			}
			return;
		}
		if (!pending) {
			if (review.pendingReviewNodeId !== null) {
				throw new ReviewError(
					"A pending GitHub review now exists. Refresh to add this reply to it.",
					409,
				);
			}
			await addReviewReply(run.repoRoot, threadNodeId, markedBody, null);
			return;
		}
		await withPendingReview(run, target, (reviewNodeId) =>
			addReviewReply(run.repoRoot, threadNodeId, markedBody, reviewNodeId),
		);
	});
}

function directReplyMarker(creationId: string): string {
	return `<!-- stagereview-direct-reply ${JSON.stringify(creationId)} -->`;
}

function directReplyBody(body: string, creationId: string): string {
	return `${body}\n\n${directReplyMarker(creationId)}`;
}

function findDirectReply(
	thread: GitHubApiReviewThread,
	viewerLogin: string,
	creationId: string,
): GitHubApiReviewThread["comments"][number] | null {
	const marker = directReplyMarker(creationId);
	const matches = thread.comments
		.slice(1)
		.filter((comment) => comment.authorLogin === viewerLogin && comment.body.includes(marker));
	if (matches.length > 1) {
		throw new ReviewError("More than one GitHub reply matches this comment creation.", 409);
	}
	return matches[0] ?? null;
}

/** Submit the viewer's pending review with the chosen event, opening one if needed (e.g. a bare approval). */
export async function submitRunReview(
	run: ChapterRunRow,
	event: ReviewEvent,
	body: string,
	creationId: string,
): Promise<void> {
	await withLockedReviewTarget(run, async (target) => {
		const { repo, prNumber, review } = target;
		const marker = reviewSubmissionMarker(creationId);
		if (await hasSubmittedReviewMarker(run.repoRoot, repo, prNumber, review.viewerLogin, marker)) {
			return;
		}
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
			submitReview(
				run.repoRoot,
				review.pullRequestNodeId,
				reviewNodeId,
				event,
				reviewSubmissionBody(body, marker),
			),
		);
	});
}

function reviewSubmissionMarker(creationId: string): string {
	return `<!-- stagereview-review-submission ${JSON.stringify(creationId)} -->`;
}

function reviewSubmissionBody(body: string, marker: string): string {
	return body === "" ? marker : `${body}\n\n${marker}`;
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
		assertPushable(run, review);
		const existing = requirePendingComment(review, nodeId);
		await updateReviewComment(
			run.repoRoot,
			nodeId,
			preserveGitHubCommentMarker(body, existing.body),
		);
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
