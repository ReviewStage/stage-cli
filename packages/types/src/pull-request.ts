import { z } from "zod";

// ─── Status enums ───────────────────────────────────────────────────────────

export const PULL_REQUEST_STATUS = {
	OPEN: "open",
	MERGED: "merged",
	CLOSED: "closed",
	DRAFT: "draft",
} as const;
export type PullRequestStatus = (typeof PULL_REQUEST_STATUS)[keyof typeof PULL_REQUEST_STATUS];

export const REVIEW_STATE = {
	APPROVED: "APPROVED",
	CHANGES_REQUESTED: "CHANGES_REQUESTED",
	COMMENTED: "COMMENTED",
	DISMISSED: "DISMISSED",
	PENDING: "PENDING",
} as const;
export type ReviewState = (typeof REVIEW_STATE)[keyof typeof REVIEW_STATE];

export const REVIEWER_STATUS = {
	...REVIEW_STATE,
	REQUESTED: "REQUESTED",
} as const;
export type ReviewerStatus = (typeof REVIEWER_STATUS)[keyof typeof REVIEWER_STATUS];

export const PULL_REQUEST_REVIEW_STATUS = {
	APPROVED: "approved",
	CHANGES_REQUESTED: "changes_requested",
	IN_REVIEW: "in_review",
	NO_REVIEWS: "no_reviews",
} as const;
export type PullRequestReviewStatus =
	(typeof PULL_REQUEST_REVIEW_STATUS)[keyof typeof PULL_REQUEST_REVIEW_STATUS];

export const PULL_REQUEST_CI_STATUS = {
	SUCCESS: "success",
	FAILURE: "failure",
	PENDING: "pending",
	NONE: "none",
} as const;
export type PullRequestCIStatus =
	(typeof PULL_REQUEST_CI_STATUS)[keyof typeof PULL_REQUEST_CI_STATUS];

export const CHECK_ITEM_SOURCE = {
	CHECK_RUN: "check_run",
	DEPLOYMENT: "deployment",
} as const;
export type CheckItemSource = (typeof CHECK_ITEM_SOURCE)[keyof typeof CHECK_ITEM_SOURCE];

export const CHECK_CONCLUSION = {
	SUCCESS: "success",
	FAILURE: "failure",
	NEUTRAL: "neutral",
	CANCELLED: "cancelled",
	SKIPPED: "skipped",
	TIMED_OUT: "timed_out",
	ACTION_REQUIRED: "action_required",
	STARTUP_FAILURE: "startup_failure",
	STALE: "stale",
} as const;
export type CheckConclusion = (typeof CHECK_CONCLUSION)[keyof typeof CHECK_CONCLUSION];

export const CHECK_ITEM_STATUS = {
	QUEUED: "queued",
	IN_PROGRESS: "in_progress",
	COMPLETED: "completed",
} as const;
export type CheckItemStatus = (typeof CHECK_ITEM_STATUS)[keyof typeof CHECK_ITEM_STATUS];

export const MERGE_STATE_STATUS = {
	BEHIND: "BEHIND",
	BLOCKED: "BLOCKED",
	CLEAN: "CLEAN",
	DIRTY: "DIRTY",
	DRAFT: "DRAFT",
	HAS_HOOKS: "HAS_HOOKS",
	UNKNOWN: "UNKNOWN",
	UNSTABLE: "UNSTABLE",
} as const;
export type MergeStateStatus = (typeof MERGE_STATE_STATUS)[keyof typeof MERGE_STATE_STATUS];

export const MERGEABLE_STATE = {
	CONFLICTING: "CONFLICTING",
	MERGEABLE: "MERGEABLE",
	UNKNOWN: "UNKNOWN",
} as const;
export type MergeableState = (typeof MERGEABLE_STATE)[keyof typeof MERGEABLE_STATE];

export const REVIEW_DECISION = {
	APPROVED: "APPROVED",
	CHANGES_REQUESTED: "CHANGES_REQUESTED",
	REVIEW_REQUIRED: "REVIEW_REQUIRED",
} as const;
export type ReviewDecision = (typeof REVIEW_DECISION)[keyof typeof REVIEW_DECISION];

export const CHECK_ROLLUP_STATE = {
	SUCCESS: "SUCCESS",
	PENDING: "PENDING",
	FAILURE: "FAILURE",
	ERROR: "ERROR",
	EXPECTED: "EXPECTED",
} as const;
export type CheckRollupState = (typeof CHECK_ROLLUP_STATE)[keyof typeof CHECK_ROLLUP_STATE];

export const PULL_REQUEST_MERGE_METHOD = {
	MERGE: "MERGE",
	SQUASH: "SQUASH",
	REBASE: "REBASE",
} as const;
export type PullRequestMergeMethod =
	(typeof PULL_REQUEST_MERGE_METHOD)[keyof typeof PULL_REQUEST_MERGE_METHOD];

// ─── Pull request ─────────────────────────────────────────────────────────────
// REST-shaped subset of GitHub's `pull-request` payload — only the fields the
// header reads. Named/shaped to match hosted Stage's `GitHubPullRequest` so the
// vendored components consume it unchanged. The CLI's gh adapter maps gh's
// GraphQL camelCase output onto this REST snake_case shape.

const GitHubUserSchema = z.object({
	login: z.string(),
	avatar_url: z.string(),
	type: z.string().optional(),
});
export type GitHubUser = z.infer<typeof GitHubUserSchema>;

export const PullRequestSchema = z.object({
	number: z.number().int().positive(),
	title: z.string(),
	html_url: z.string(),
	state: z.enum(["open", "closed"]),
	draft: z.boolean(),
	merged_at: z.string().nullable(),
	created_at: z.string(),
	user: GitHubUserSchema.nullable(),
	head: z.object({ ref: z.string(), sha: z.string() }),
	base: z.object({ ref: z.string() }),
});
export type GitHubPullRequest = z.infer<typeof PullRequestSchema>;

export const PullRequestResponseSchema = z.object({
	/** The PR associated with the repo's current branch, or null when none is found. */
	pullRequest: PullRequestSchema.nullable(),
});
export type PullRequestResponse = z.infer<typeof PullRequestResponseSchema>;

// ─── CI checks ──────────────────────────────────────────────────────────────

export const CheckItemSchema = z.object({
	source: z.enum(CHECK_ITEM_SOURCE),
	id: z.number(),
	name: z.string(),
	status: z.enum(CHECK_ITEM_STATUS),
	conclusion: z.enum(CHECK_CONCLUSION).nullable(),
	startedAt: z.string().nullable(),
	completedAt: z.string().nullable(),
	url: z.string().nullable(),
	avatarUrl: z.string().nullable(),
	appName: z.string(),
});
export type CheckItem = z.infer<typeof CheckItemSchema>;

export const DeploymentLinkSchema = z.object({
	environment: z.string(),
	url: z.string(),
});
export type DeploymentLink = z.infer<typeof DeploymentLinkSchema>;

export const ChecksResponseSchema = z.object({
	state: z.enum(PULL_REQUEST_CI_STATUS),
	items: z.array(CheckItemSchema),
	deploymentLinks: z.array(DeploymentLinkSchema),
});
export type ChecksResponse = z.infer<typeof ChecksResponseSchema>;

// ─── Reviews ────────────────────────────────────────────────────────────────

const ReviewUserSchema = z.object({
	login: z.string(),
	avatar_url: z.string(),
	type: z.string(),
});
export type ReviewUser = z.infer<typeof ReviewUserSchema>;

export const ReviewerSchema = z.object({
	user: ReviewUserSchema,
	status: z.enum(REVIEWER_STATUS),
});
export type Reviewer = z.infer<typeof ReviewerSchema>;

export const PullRequestReviewSummarySchema = z.object({
	status: z.enum(PULL_REQUEST_REVIEW_STATUS),
	reviewers: z.array(ReviewerSchema),
});
export type PullRequestReviewSummary = z.infer<typeof PullRequestReviewSummarySchema>;

export const ReviewsResponseSchema = z.object({
	reviews: PullRequestReviewSummarySchema.nullable(),
});
export type ReviewsResponse = z.infer<typeof ReviewsResponseSchema>;

// ─── Merge status ─────────────────────────────────────────────────────────────

export const MergeQueueEntrySchema = z.object({
	id: z.string(),
	position: z.number(),
	estimatedTimeToMerge: z.number().nullable(),
});
export type MergeQueueEntry = z.infer<typeof MergeQueueEntrySchema>;

export const MergeStatusInfoSchema = z.object({
	mergeable: z.enum(MERGEABLE_STATE),
	mergeStateStatus: z.enum(MERGE_STATE_STATUS),
	reviewDecision: z.enum(REVIEW_DECISION).nullable(),
	checkRollupState: z.enum(CHECK_ROLLUP_STATE).nullable(),
	autoMergeEnabled: z.boolean(),
	autoMergeAllowed: z.boolean(),
	viewerCanEnableAutoMerge: z.boolean(),
	viewerCanDisableAutoMerge: z.boolean(),
	isMergeQueueEnabled: z.boolean(),
	isInMergeQueue: z.boolean(),
	entry: MergeQueueEntrySchema.nullable(),
	allowedMergeMethods: z.array(z.enum(PULL_REQUEST_MERGE_METHOD)),
});
export type MergeStatusInfo = z.infer<typeof MergeStatusInfoSchema>;

export const MergeStatusResponseSchema = z.object({
	mergeStatus: MergeStatusInfoSchema.nullable(),
});
export type MergeStatusResponse = z.infer<typeof MergeStatusResponseSchema>;
