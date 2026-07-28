import { z } from "zod";
import { DIFF_SIDE } from "./chapters.ts";

// A comment's lifecycle state. `local` lives only in the CLI; `pending` is a draft
// on the viewer's unsubmitted GitHub review (only they see it); `submitted` is
// published on the PR for everyone.
export const COMMENT_STATE = {
	LOCAL: "local",
	PENDING: "pending",
	SUBMITTED: "submitted",
} as const;
export type CommentState = (typeof COMMENT_STATE)[keyof typeof COMMENT_STATE];

// Where a thread originates. `local` threads are CLI-only rows; `github` threads
// are live review threads on the PR (pending and/or submitted comments).
export const THREAD_SOURCE = {
	LOCAL: "local",
	GITHUB: "github",
} as const;
export type ThreadSource = (typeof THREAD_SOURCE)[keyof typeof THREAD_SOURCE];

// The events a review can be submitted with, mirroring GitHub's review model.
export const REVIEW_EVENT = {
	COMMENT: "COMMENT",
	APPROVE: "APPROVE",
	REQUEST_CHANGES: "REQUEST_CHANGES",
} as const;
export type ReviewEvent = (typeof REVIEW_EVENT)[keyof typeof REVIEW_EVENT];

// Whether the GitHub review layer is usable for this run. `none` = not a GitHub PR;
// `offline` = `gh` is missing/unauthenticated/unreachable (GitHub actions disabled);
// `available` = the PR's review state loaded.
export const GITHUB_REVIEW_STATUS = {
	NONE: "none",
	OFFLINE: "offline",
	AVAILABLE: "available",
} as const;
export type GitHubReviewStatus = (typeof GITHUB_REVIEW_STATUS)[keyof typeof GITHUB_REVIEW_STATUS];

export const ReviewCommentAuthorSchema = z.object({
	login: z.string(),
	avatarUrl: z.string().nullable(),
});
export type ReviewCommentAuthor = z.infer<typeof ReviewCommentAuthorSchema>;

// A single comment in a thread. `author` is null for local comments (the local
// reviewer, "You"). `nodeId` is the GitHub GraphQL id, present for github comments
// (needed to edit/delete pending ones). `commentId` is the local row id for local
// comments.
export const ReviewCommentSchema = z.object({
	id: z.string(),
	state: z.enum(COMMENT_STATE),
	body: z.string(),
	// GitHub's server-rendered HTML (resolves @mentions/#refs/emoji); null for local comments.
	bodyHtml: z.string().nullable(),
	author: ReviewCommentAuthorSchema.nullable(),
	nodeId: z.string().nullable(),
	// Permalink to the comment on GitHub; null for local comments.
	htmlUrl: z.string().nullable(),
	createdAt: z.string(),
});
export type ReviewComment = z.infer<typeof ReviewCommentSchema>;

// A line-anchored thread. Local and github threads share this shape so the diff
// viewer can place both uniformly; `side`/`startLine`/`endLine` are normalized to
// the local diff convention. `threadNodeId` is set for github threads (resolve/reply).
export const ReviewThreadSchema = z.object({
	id: z.string(),
	source: z.enum(THREAD_SOURCE),
	threadNodeId: z.string().nullable(),
	filePath: z.string(),
	side: z.enum(DIFF_SIDE),
	startLine: z.number().int().positive(),
	endLine: z.number().int().positive(),
	isResolved: z.boolean(),
	comments: z.array(ReviewCommentSchema),
});
export type ReviewThread = z.infer<typeof ReviewThreadSchema>;

export const PendingReviewCommentSchema = z.object({
	id: z.string(),
	filePath: z.string(),
	line: z.number().int().positive().nullable(),
	body: z.string(),
});
export type PendingReviewComment = z.infer<typeof PendingReviewCommentSchema>;

export const ReviewResponseSchema = z.object({
	github: z.enum(GITHUB_REVIEW_STATUS),
	threads: z.array(ReviewThreadSchema),
	// Includes anchorless/outdated drafts that cannot be placed in `threads`.
	pendingComments: z.array(PendingReviewCommentSchema),
	pendingCommentCount: z.number().int().nonnegative(),
	hasPendingReview: z.boolean(),
	// The viewer opened this PR — GitHub forbids approving/requesting changes on it.
	isOwnPullRequest: z.boolean(),
	// Whether comments can be added to the PR right now — true when the run's diff IS
	// the PR's current diff (a committed run whose head equals the PR head). When false,
	// only local comments are allowed (the GitHub review isn't shown for this diff).
	canPushToReview: z.boolean(),
});
export type ReviewResponse = z.infer<typeof ReviewResponseSchema>;

// ─── Action bodies ──────────────────────────────────────────────────────────────

// Promote a local comment to a pending GitHub review comment (or reply). The local
// thread/comment is identified by id; the server reads its anchor + body.
export const AddToReviewBodySchema = z.object({
	localThreadId: z.string().min(1),
});
export type AddToReviewBody = z.infer<typeof AddToReviewBodySchema>;

export const SubmitReviewBodySchema = z.object({
	event: z.enum(REVIEW_EVENT),
	body: z.string(),
});
export type SubmitReviewBody = z.infer<typeof SubmitReviewBodySchema>;

// Reply to a github thread. `pending` (default) adds the reply to the viewer's
// pending review; false posts it immediately as a single comment.
export const GitHubReplyBodySchema = z.object({
	threadNodeId: z.string().min(1),
	body: z.string().min(1),
	pending: z.boolean().default(true),
});
export type GitHubReplyBody = z.infer<typeof GitHubReplyBodySchema>;

// Edit/delete a pending github comment by node id.
export const GitHubCommentEditBodySchema = z.object({
	nodeId: z.string().min(1),
	body: z.string().min(1),
});
export type GitHubCommentEditBody = z.infer<typeof GitHubCommentEditBodySchema>;

export const GitHubCommentDeleteBodySchema = z.object({
	nodeId: z.string().min(1),
});
export type GitHubCommentDeleteBody = z.infer<typeof GitHubCommentDeleteBodySchema>;

// Resolve/reopen a github thread by node id.
export const GitHubResolveBodySchema = z.object({
	threadNodeId: z.string().min(1),
	resolved: z.boolean(),
});
export type GitHubResolveBody = z.infer<typeof GitHubResolveBodySchema>;
