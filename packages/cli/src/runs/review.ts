import {
	COMMENT_STATE,
	GITHUB_REVIEW_STATUS,
	REVIEW_EVENT,
	type ReviewComment as ReviewCommentDto,
	type ReviewEvent,
	type ReviewResponse,
	type ReviewThread as ReviewThreadDto,
	THREAD_SOURCE,
} from "@stagereview/types/review";
import { asc, eq } from "drizzle-orm";
import type { StageDb } from "../db/client.js";
import { type ChapterRunRow, comment, commentThread } from "../db/schema/index.js";
import { type GitHubRepo, getPullRequest, parseGitHubRepo } from "../github/index.js";
import {
	addReviewReply,
	addReviewThread,
	createPendingReview,
	deleteReviewComment,
	discardReview,
	GITHUB_DIFF_SIDE,
	type GitHubDiffSide,
	type GitHubReview,
	type ReviewThread as GitHubReviewThread,
	getReview,
	setThreadResolved,
	submitReview,
	updateReviewComment,
} from "../github/review.js";
import { DIFF_SIDE, type DiffSide, SCOPE_KIND } from "../schema.js";
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
 * tree line numbers aren't the PR's) whose head is the PR head. This is the load-
 * bearing invariant for both showing live PR threads and adding comments to the PR;
 * the live worktree state is irrelevant — a committed run's anchors are fixed by its
 * recorded SHAs.
 */
function runMatchesPrDiff(run: ChapterRunRow, headRefOid: string): boolean {
	return run.scopeKind === SCOPE_KIND.COMMITTED && run.headSha === headRefOid;
}

function assertPushable(run: ChapterRunRow, review: GitHubReview): void {
	if (runMatchesPrDiff(run, review.headRefOid)) return;
	const reason =
		run.scopeKind !== SCOPE_KIND.COMMITTED
			? "Only comments on a committed diff can be added to the PR — working-tree comments aren't anchored to the PR's commits."
			: "This run's diff doesn't match the current PR head. Re-run against the latest PR commit to comment on it.";
	throw new ReviewError(reason, 409);
}

// ─── Read: merged local + GitHub review ─────────────────────────────────────────

function loadLocalThreads(db: StageDb, scopeKey: string): ReviewThreadDto[] {
	const threads = db
		.select()
		.from(commentThread)
		.where(eq(commentThread.scopeKey, scopeKey))
		.orderBy(asc(commentThread.createdAt))
		.all();
	return threads.map((thread): ReviewThreadDto => {
		const comments = db
			.select()
			.from(comment)
			.where(eq(comment.threadId, thread.id))
			.orderBy(asc(comment.createdAt))
			.all();
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
				(c): ReviewCommentDto => ({
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

function toGitHubThreadDto(t: GitHubReviewThread): ReviewThreadDto {
	// `line` is non-null (getReview drops anchorless threads); start defaults to line.
	const endLine = t.line ?? t.startLine ?? 1;
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
			(c): ReviewCommentDto => ({
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
	const localThreads = loadLocalThreads(db, deriveScopeKey(run));
	const base = {
		threads: localThreads,
		pendingCommentCount: 0,
		hasPendingReview: false,
		isOwnPullRequest: false,
		canPushToReview: false,
	};

	const repo = parseGitHubRepo(run.originUrl);
	if (!repo) return { ...base, github: GITHUB_REVIEW_STATUS.NONE };

	let prNumber = run.prNumber;
	if (prNumber === null) {
		const pr = await getPullRequest(run.repoRoot, run.originUrl, null);
		prNumber = pr?.number ?? null;
	}
	if (prNumber === null) return { ...base, github: GITHUB_REVIEW_STATUS.NONE };

	let review: GitHubReview;
	try {
		review = await getReview(run.repoRoot, repo, prNumber);
	} catch {
		return { ...base, github: GITHUB_REVIEW_STATUS.OFFLINE };
	}

	// The PR's live threads anchor to its head-commit diff. If this run isn't that
	// exact diff, overlaying them would mis-anchor comments on unrelated lines, so we
	// surface only local comments — the GitHub review isn't meaningful for this diff.
	if (!runMatchesPrDiff(run, review.headRefOid)) {
		return { ...base, github: GITHUB_REVIEW_STATUS.NONE };
	}

	const githubThreads = review.threads.map(toGitHubThreadDto);
	return {
		github: GITHUB_REVIEW_STATUS.AVAILABLE,
		threads: [...localThreads, ...githubThreads],
		// Raw count from getReview includes pending drafts on anchorless threads we don't render.
		pendingCommentCount: review.pendingCommentCount,
		hasPendingReview: review.pendingReviewNodeId !== null,
		isOwnPullRequest: review.viewerDidAuthor,
		canPushToReview: true,
	};
}

// ─── Write: review actions ──────────────────────────────────────────────────────

interface ReviewTarget {
	repo: GitHubRepo;
	prNumber: number;
	review: GitHubReview;
}

/** Resolve the run's PR and load its live review, throwing a user-facing error when unavailable. */
async function loadTarget(run: ChapterRunRow): Promise<ReviewTarget> {
	const repo = parseGitHubRepo(run.originUrl);
	if (!repo) throw new ReviewError("This run isn't associated with a GitHub remote.", 404);
	let prNumber = run.prNumber;
	if (prNumber === null) {
		const pr = await getPullRequest(run.repoRoot, run.originUrl, null);
		prNumber = pr?.number ?? null;
	}
	if (prNumber === null) {
		throw new ReviewError("No GitHub pull request found for this run.", 404);
	}
	const review = await getReview(run.repoRoot, repo, prNumber);
	return { repo, prNumber, review };
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
		reviewNodeId: await createPendingReview(run.repoRoot, review.pullRequestNodeId),
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
		if (created) await discardReview(run.repoRoot, reviewNodeId).catch(() => {});
		throw err;
	}
}

// Local thread ids currently mid-promotion. The server is a single process, so this
// in-memory set serializes concurrent /review/add calls for the same thread (e.g. a
// double-click): the second request is rejected instead of racing to create a
// duplicate pending GitHub thread before the first deletes the local row.
const promotingThreads = new Set<string>();

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
	if (promotingThreads.has(localThreadId)) {
		throw new ReviewError("This comment is already being added to the review.", 409);
	}
	promotingThreads.add(localThreadId);
	try {
		await promoteLocalThread(db, run, localThreadId);
	} finally {
		promotingThreads.delete(localThreadId);
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
	// The thread must belong to this run's diff scope; its anchor was computed
	// against that diff, so promoting one from another scope would mis-anchor.
	if (thread.scopeKey !== deriveScopeKey(run)) {
		throw new ReviewError("This comment doesn't belong to this run's diff.", 400);
	}
	const comments = db
		.select()
		.from(comment)
		.where(eq(comment.threadId, localThreadId))
		.orderBy(asc(comment.createdAt))
		.all();
	const root = comments[0];
	if (!root) throw new ReviewError("Thread has no comments to add to the review.", 400);

	const { review } = await loadTarget(run);
	assertPushable(run, review);
	const { reviewNodeId, created } = await openPendingReview(run, review);
	const side = toGitHubSide(thread.side);
	const startLine = thread.endLine !== thread.startLine ? thread.startLine : null;

	let threadNodeId: string;
	try {
		threadNodeId = await addReviewThread(run.repoRoot, {
			pullRequestNodeId: review.pullRequestNodeId,
			reviewNodeId,
			path: thread.filePath,
			body: root.body,
			line: thread.endLine,
			side,
			startLine,
			startSide: startLine !== null ? side : null,
		});
	} catch (err) {
		// Don't leave an empty review behind if the root couldn't be posted.
		if (created) await discardReview(run.repoRoot, reviewNodeId).catch(() => {});
		throw err;
	}
	// Delete each local comment only once its GitHub counterpart lands, so a failure
	// part-way never loses an unposted comment (the leftover replies stay local) and
	// never leaves the already-promoted root behind to be re-promoted as a duplicate.
	db.delete(comment).where(eq(comment.id, root.id)).run();
	for (const reply of comments.slice(1)) {
		await addReviewReply(run.repoRoot, threadNodeId, reply.body, reviewNodeId);
		db.delete(comment).where(eq(comment.id, reply.id)).run();
	}
	// Every comment promoted — drop the now-empty local thread.
	db.delete(commentThread).where(eq(commentThread.id, localThreadId)).run();
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
	const { review } = await loadTarget(run);
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
}

/** Reply to a GitHub thread, adding to the viewer's pending review (or as a single comment). */
export async function replyToGitHubThread(
	run: ChapterRunRow,
	threadNodeId: string,
	body: string,
	pending: boolean,
): Promise<void> {
	const { review } = await loadTarget(run);
	// Same guard as the comment paths: don't act on the PR from a run whose diff
	// isn't the PR's current diff (the thread on screen may not be what's live).
	assertPushable(run, review);
	if (!pending) {
		await addReviewReply(run.repoRoot, threadNodeId, body, null);
		return;
	}
	await withPendingReview(run, review, (reviewNodeId) =>
		addReviewReply(run.repoRoot, threadNodeId, body, reviewNodeId),
	);
}

/** Submit the viewer's pending review with the chosen event, opening one if needed (e.g. a bare approval). */
export async function submitRunReview(
	run: ChapterRunRow,
	event: ReviewEvent,
	body: string,
): Promise<void> {
	const { review } = await loadTarget(run);
	// A review approves/comments on the PR's current diff; block submitting from a run
	// whose diff isn't that, even via the API (the UI already hides the tray then).
	assertPushable(run, review);
	// Mirror the tray's rule at the API boundary: a Comment review needs a summary or
	// at least one pending comment, else we'd open and submit an empty review. Uses the
	// raw pending count (includes anchorless drafts getReview drops) to avoid a false reject.
	if (event === REVIEW_EVENT.COMMENT && body.trim() === "" && review.pendingCommentCount === 0) {
		throw new ReviewError("Add a summary or at least one pending comment to submit a review.", 400);
	}
	await withPendingReview(run, review, (reviewNodeId) =>
		submitReview(run.repoRoot, review.pullRequestNodeId, reviewNodeId, event, body),
	);
}

/** Discard the viewer's pending review and all its draft comments. */
export async function discardRunReview(run: ChapterRunRow): Promise<void> {
	const { review } = await loadTarget(run);
	if (review.pendingReviewNodeId === null) {
		throw new ReviewError("There's no pending review to discard.", 409);
	}
	await discardReview(run.repoRoot, review.pendingReviewNodeId);
}

/** Edit a GitHub review comment by node id (used for pending comments). */
export async function editGitHubComment(
	run: ChapterRunRow,
	nodeId: string,
	body: string,
): Promise<void> {
	await updateReviewComment(run.repoRoot, nodeId, body);
}

/** Delete a pending GitHub review comment by node id. */
export async function deleteGitHubComment(run: ChapterRunRow, nodeId: string): Promise<void> {
	await deleteReviewComment(run.repoRoot, nodeId);
}

/** Resolve or reopen a GitHub review thread. */
export async function resolveGitHubThread(
	run: ChapterRunRow,
	threadNodeId: string,
	resolved: boolean,
): Promise<void> {
	await setThreadResolved(run.repoRoot, threadNodeId, resolved);
}
