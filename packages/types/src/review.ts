import { z } from "zod";
import { DIFF_SIDE } from "./chapters.ts";
import { CreateCommentThreadBodySchema } from "./comments.ts";

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

const ReviewCommentBaseSchema = z.object({
	id: z.string(),
	body: z.string(),
	createdAt: z.string(),
});

export const LocalReviewCommentSchema = ReviewCommentBaseSchema.extend({
	state: z.literal(COMMENT_STATE.LOCAL),
	bodyHtml: z.null(),
	author: z.null(),
	nodeId: z.null(),
	htmlUrl: z.null(),
});
export type LocalReviewComment = z.infer<typeof LocalReviewCommentSchema>;

export const GitHubReviewCommentSchema = ReviewCommentBaseSchema.extend({
	state: z.union([z.literal(COMMENT_STATE.PENDING), z.literal(COMMENT_STATE.SUBMITTED)]),
	// GitHub's server-rendered HTML resolves @mentions, issue references, and emoji.
	bodyHtml: z.string(),
	author: ReviewCommentAuthorSchema,
	nodeId: z.string().min(1),
	htmlUrl: z.string(),
});
export type GitHubReviewComment = z.infer<typeof GitHubReviewCommentSchema>;

/** A local-only comment or a GitHub-backed pending/submitted comment. */
export const ReviewCommentSchema = z.union([LocalReviewCommentSchema, GitHubReviewCommentSchema]);
export type ReviewComment = z.infer<typeof ReviewCommentSchema>;

const ReviewThreadBaseSchema = z.object({
	id: z.string(),
	filePath: z.string(),
	side: z.enum(DIFF_SIDE),
	startLine: z.number().int().positive(),
	endLine: z.number().int().positive(),
	isResolved: z.boolean(),
});

export const LocalReviewThreadSchema = ReviewThreadBaseSchema.extend({
	source: z.literal(THREAD_SOURCE.LOCAL),
	threadNodeId: z.null(),
	comments: z.array(LocalReviewCommentSchema),
});
export type LocalReviewThread = z.infer<typeof LocalReviewThreadSchema>;

export const GitHubReviewThreadSchema = ReviewThreadBaseSchema.extend({
	source: z.literal(THREAD_SOURCE.GITHUB),
	threadNodeId: z.string().min(1),
	startSide: z.enum(DIFF_SIDE),
	viewerCanResolve: z.boolean(),
	viewerCanUnresolve: z.boolean(),
	comments: z.array(GitHubReviewCommentSchema),
});
export type GitHubReviewThread = z.infer<typeof GitHubReviewThreadSchema>;

/** A line-anchored local or GitHub thread with source-specific identifier invariants. */
export const ReviewThreadSchema = z.discriminatedUnion("source", [
	LocalReviewThreadSchema,
	GitHubReviewThreadSchema,
]);
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
	// Existing summary text on the viewer's pending GitHub review.
	pendingReviewBody: z.string(),
	// The viewer opened this PR — GitHub forbids approving/requesting changes on it.
	isOwnPullRequest: z.boolean(),
	// Whether pending-review actions are allowed. In addition to an open, matching
	// PR diff, any existing pending review must be pinned to the current head.
	canPushToReview: z.boolean(),
	// Whether direct GitHub thread actions are allowed. This can remain true when an
	// older pending review blocks draft writes, but is false for a closed PR or mismatched diff.
	canWriteToGitHub: z.boolean(),
});
export type ReviewResponse = z.infer<typeof ReviewResponseSchema>;

// ─── Action bodies ──────────────────────────────────────────────────────────────

// Promote a local comment to a pending GitHub review comment (or reply). The local
// thread/comment is identified by id; the server reads its anchor + body.
export const AddToReviewBodySchema = z.object({
	localThreadId: z.string().min(1),
});
export type AddToReviewBody = z.infer<typeof AddToReviewBodySchema>;

export const GitHubCommentCreateBodySchema = CreateCommentThreadBodySchema.safeExtend({
	pending: z.boolean().default(true),
});
export type GitHubCommentCreateBody = z.infer<typeof GitHubCommentCreateBodySchema>;

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
