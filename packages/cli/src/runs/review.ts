import {
	COMMENT_STATE,
	GITHUB_REVIEW_STATUS,
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
import { DIFF_SIDE, type DiffSide } from "../schema.js";
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
					author: null,
					nodeId: null,
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
				author: { login: c.authorLogin, avatarUrl: c.authorAvatarUrl || null },
				nodeId: c.nodeId,
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
	const base = { threads: localThreads, pendingCommentCount: 0, hasPendingReview: false };

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

	const githubThreads = review.threads.map(toGitHubThreadDto);
	const pendingCommentCount = review.threads.reduce(
		(n, t) => n + t.comments.filter((c) => c.isPending).length,
		0,
	);
	return {
		github: GITHUB_REVIEW_STATUS.AVAILABLE,
		threads: [...localThreads, ...githubThreads],
		pendingCommentCount,
		hasPendingReview: review.pendingReviewNodeId !== null,
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

/** The viewer's pending review node id, creating an empty pending review if none is open. */
async function ensurePendingReview(run: ChapterRunRow, review: GitHubReview): Promise<string> {
	if (review.pendingReviewNodeId !== null) return review.pendingReviewNodeId;
	return createPendingReview(run.repoRoot, review.pullRequestNodeId);
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
	const [thread] = db
		.select()
		.from(commentThread)
		.where(eq(commentThread.id, localThreadId))
		.limit(1)
		.all();
	if (!thread) throw new ReviewError(`Thread ${localThreadId} not found`, 404);
	const comments = db
		.select()
		.from(comment)
		.where(eq(comment.threadId, localThreadId))
		.orderBy(asc(comment.createdAt))
		.all();
	const root = comments[0];
	if (!root) throw new ReviewError("Thread has no comments to add to the review.", 400);

	const { review } = await loadTarget(run);
	const reviewNodeId = await ensurePendingReview(run, review);
	const side = toGitHubSide(thread.side);
	const startLine = thread.endLine !== thread.startLine ? thread.startLine : null;

	const threadNodeId = await addReviewThread(run.repoRoot, {
		pullRequestNodeId: review.pullRequestNodeId,
		reviewNodeId,
		path: thread.filePath,
		body: root.body,
		line: thread.endLine,
		side,
		startLine,
		startSide: startLine !== null ? side : null,
	});
	for (const reply of comments.slice(1)) {
		await addReviewReply(run.repoRoot, threadNodeId, reply.body, reviewNodeId);
	}
	// Promoted: remove the local copy so it doesn't double up with the live pending one.
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
	const reviewNodeId = await ensurePendingReview(run, review);
	const side = toGitHubSide(anchor.side);
	const startLine = anchor.endLine !== anchor.startLine ? anchor.startLine : null;
	await addReviewThread(run.repoRoot, {
		pullRequestNodeId: review.pullRequestNodeId,
		reviewNodeId,
		path: anchor.filePath,
		body: anchor.body,
		line: anchor.endLine,
		side,
		startLine,
		startSide: startLine !== null ? side : null,
	});
}

/** Reply to a GitHub thread, adding to the viewer's pending review (or as a single comment). */
export async function replyToGitHubThread(
	run: ChapterRunRow,
	threadNodeId: string,
	body: string,
	pending: boolean,
): Promise<void> {
	if (!pending) {
		await addReviewReply(run.repoRoot, threadNodeId, body, null);
		return;
	}
	const { review } = await loadTarget(run);
	const reviewNodeId = await ensurePendingReview(run, review);
	await addReviewReply(run.repoRoot, threadNodeId, body, reviewNodeId);
}

/** Submit the viewer's pending review with the chosen event, opening one if needed (e.g. a bare approval). */
export async function submitRunReview(
	run: ChapterRunRow,
	event: ReviewEvent,
	body: string,
): Promise<void> {
	const { review } = await loadTarget(run);
	const reviewNodeId = await ensurePendingReview(run, review);
	await submitReview(run.repoRoot, review.pullRequestNodeId, reviewNodeId, event, body);
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
