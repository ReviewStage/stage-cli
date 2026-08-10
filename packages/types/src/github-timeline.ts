import { z } from "zod";

// Wire format for the GitHub pull-request timeline (Activity tab), mirroring hosted
// Stage's `packages/types/src/github-timeline.ts`. Hosted types these payloads with
// Octokit's REST schemas; the CLI receives untyped `gh api` JSON instead, so each
// shape is a Zod schema carrying only the fields the UI consumes (parsing strips
// the rest of GitHub's payload).

// ─── Users & reactions ────────────────────────────────────────────────────────

export const TimelineUserSchema = z.object({
	login: z.string(),
	avatar_url: z.string(),
	type: z.string().optional(),
});
export type TimelineUser = z.infer<typeof TimelineUserSchema>;

/**
 * GitHub returns `user: null` for content authored by deleted accounts and
 * displays it as the @ghost user; normalize to the same placeholder so the
 * comment survives validation instead of dropping out of the timeline.
 */
export const GHOST_TIMELINE_USER: TimelineUser = {
	login: "ghost",
	avatar_url: "https://avatars.githubusercontent.com/u/10137?v=4",
	type: "User",
};

export const NullableTimelineUserSchema = TimelineUserSchema.nullable().transform(
	(user) => user ?? GHOST_TIMELINE_USER,
);

export const REACTION_CONTENT = {
	THUMBS_UP: "+1",
	THUMBS_DOWN: "-1",
	LAUGH: "laugh",
	HOORAY: "hooray",
	CONFUSED: "confused",
	HEART: "heart",
	ROCKET: "rocket",
	EYES: "eyes",
} as const;
export type ReactionContentKey = (typeof REACTION_CONTENT)[keyof typeof REACTION_CONTENT];

/** Maps reaction content keys (e.g. "+1", "heart") to the logins of users who reacted. */
export const ReactionUserMapSchema = z.partialRecord(z.enum(REACTION_CONTENT), z.array(z.string()));
export type ReactionUserMap = z.infer<typeof ReactionUserMapSchema>;

// ─── Comments & reviews ───────────────────────────────────────────────────────

const GitHubAppRefSchema = z.object({
	id: z.number(),
	slug: z.string().nullable().optional(),
});

export const TimelineIssueCommentSchema = z.object({
	id: z.number(),
	node_id: z.string(),
	user: NullableTimelineUserSchema,
	body: z.string().optional(),
	/** GitHub's server-rendered HTML (full media type) — resolves @mentions, refs, emoji. */
	body_html: z.string().optional(),
	created_at: z.string(),
	updated_at: z.string().optional(),
	html_url: z.string(),
	performed_via_github_app: GitHubAppRefSchema.nullable().optional(),
});
export type TimelineIssueComment = z.infer<typeof TimelineIssueCommentSchema>;

const ReviewDismissalSchema = z.object({
	original_state: z.string(),
	actor: TimelineUserSchema,
	dismissal_message: z.string().nullable(),
	created_at: z.string(),
});

/** Enriched review: GitHub's reviewed timeline event + optional dismissal metadata. */
export const TimelineReviewSchema = z.object({
	id: z.number(),
	node_id: z.string(),
	user: NullableTimelineUserSchema,
	body: z.string().nullable(),
	body_html: z.string().optional(),
	state: z.string(),
	html_url: z.string(),
	submitted_at: z.string().optional(),
	dismissal: ReviewDismissalSchema.optional(),
});
export type TimelineReview = z.infer<typeof TimelineReviewSchema>;

const COMMENT_SIDE_VALUES = ["LEFT", "RIGHT"] as const;

export const TimelineReviewCommentSchema = z.object({
	id: z.number(),
	node_id: z.string(),
	pull_request_review_id: z.number().nullable().optional(),
	in_reply_to_id: z.number().optional(),
	user: TimelineUserSchema.nullable(),
	body: z.string(),
	body_html: z.string().optional(),
	created_at: z.string(),
	html_url: z.string(),
	path: z.string(),
	/** Frozen at comment-creation time; sliced with original_* coordinates for previews. */
	diff_hunk: z.string().optional(),
	line: z.number().nullable().optional(),
	original_line: z.number().nullable().optional(),
	start_line: z.number().nullable().optional(),
	original_start_line: z.number().nullable().optional(),
	side: z.enum(COMMENT_SIDE_VALUES).nullable().optional(),
	start_side: z.enum(COMMENT_SIDE_VALUES).nullable().optional(),
	subject_type: z.enum(["line", "file"]).nullable().optional(),
});
export type TimelineReviewComment = z.infer<typeof TimelineReviewCommentSchema>;

// ─── Non-discussion timeline events ───────────────────────────────────────────

export const TimelineCommittedEventSchema = z.object({
	sha: z.string(),
	message: z.string(),
	author: z.object({ name: z.string().optional(), date: z.string() }),
});
export type TimelineCommittedEvent = z.infer<typeof TimelineCommittedEventSchema>;

const ActorEventBaseSchema = z.object({
	id: z.number(),
	actor: TimelineUserSchema,
	created_at: z.string(),
});

const LabelRefSchema = z.object({ name: z.string(), color: z.string() });

export const LabeledEventSchema = ActorEventBaseSchema.extend({ label: LabelRefSchema });
export type LabeledEvent = z.infer<typeof LabeledEventSchema>;

export const AssignedEventSchema = ActorEventBaseSchema.extend({ assignee: TimelineUserSchema });
export type AssignedEvent = z.infer<typeof AssignedEventSchema>;

export const ReviewRequestEventSchema = ActorEventBaseSchema.extend({
	requested_reviewer: TimelineUserSchema.optional(),
	requested_team: z.object({ name: z.string() }).optional(),
});
export type ReviewRequestEvent = z.infer<typeof ReviewRequestEventSchema>;

export const MilestonedEventSchema = ActorEventBaseSchema.extend({
	milestone: z.object({ title: z.string() }),
});
export type MilestonedEvent = z.infer<typeof MilestonedEventSchema>;

export const RenamedEventSchema = ActorEventBaseSchema.extend({
	rename: z.object({ from: z.string(), to: z.string() }),
});
export type RenamedEvent = z.infer<typeof RenamedEventSchema>;

export const LockedEventSchema = ActorEventBaseSchema.extend({
	lock_reason: z.string().nullable().optional(),
});
export type LockedEvent = z.infer<typeof LockedEventSchema>;

export const CrossReferencedEventSchema = z.object({
	actor: TimelineUserSchema.nullable().optional(),
	created_at: z.string(),
	source: z.object({
		issue: z.object({ html_url: z.string(), title: z.string() }).optional(),
	}),
});
export type CrossReferencedEvent = z.infer<typeof CrossReferencedEventSchema>;

/** GitHub `event` values that share the state-change schema. */
export const STATE_CHANGE_EVENT = {
	CLOSED: "closed",
	REOPENED: "reopened",
	MERGED: "merged",
	HEAD_REF_FORCE_PUSHED: "head_ref_force_pushed",
	CONVERT_TO_DRAFT: "convert_to_draft",
	READY_FOR_REVIEW: "ready_for_review",
} as const;
export type StateChangeEventName = (typeof STATE_CHANGE_EVENT)[keyof typeof STATE_CHANGE_EVENT];

export const StateChangeEventSchema = ActorEventBaseSchema.extend({
	event: z.enum(STATE_CHANGE_EVENT),
});
export type StateChangeEvent = z.infer<typeof StateChangeEventSchema>;

export const DeployedEventSchema = ActorEventBaseSchema;
export type DeployedEvent = z.infer<typeof DeployedEventSchema>;

export const MergeQueueEventSchema = ActorEventBaseSchema;
export type MergeQueueEvent = z.infer<typeof MergeQueueEventSchema>;

// ─── Timeline event union ─────────────────────────────────────────────────────

export const TIMELINE_EVENT_TYPE = {
	ISSUE_COMMENT: "issue_comment",
	REVIEW: "review",
	COMMITTED: "committed",
	LABELED: "labeled",
	UNLABELED: "unlabeled",
	ASSIGNED: "assigned",
	UNASSIGNED: "unassigned",
	REVIEW_REQUESTED: "review_requested",
	REVIEW_REQUEST_REMOVED: "review_request_removed",
	MILESTONED: "milestoned",
	DEMILESTONED: "demilestoned",
	RENAMED: "renamed",
	LOCKED: "locked",
	CROSS_REFERENCED: "cross_referenced",
	STATE_CHANGE: "state_change",
	DEPLOYED: "deployed",
	ADDED_TO_MERGE_QUEUE: "added_to_merge_queue",
	REMOVED_FROM_MERGE_QUEUE: "removed_from_merge_queue",
} as const;
export type TimelineEventType = (typeof TIMELINE_EVENT_TYPE)[keyof typeof TIMELINE_EVENT_TYPE];

export const TimelineEventSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal(TIMELINE_EVENT_TYPE.ISSUE_COMMENT),
		data: TimelineIssueCommentSchema,
	}),
	z.object({
		type: z.literal(TIMELINE_EVENT_TYPE.REVIEW),
		data: TimelineReviewSchema,
		comments: z.array(TimelineReviewCommentSchema),
	}),
	z.object({ type: z.literal(TIMELINE_EVENT_TYPE.COMMITTED), data: TimelineCommittedEventSchema }),
	z.object({ type: z.literal(TIMELINE_EVENT_TYPE.LABELED), data: LabeledEventSchema }),
	z.object({ type: z.literal(TIMELINE_EVENT_TYPE.UNLABELED), data: LabeledEventSchema }),
	z.object({ type: z.literal(TIMELINE_EVENT_TYPE.ASSIGNED), data: AssignedEventSchema }),
	z.object({ type: z.literal(TIMELINE_EVENT_TYPE.UNASSIGNED), data: AssignedEventSchema }),
	z.object({
		type: z.literal(TIMELINE_EVENT_TYPE.REVIEW_REQUESTED),
		data: ReviewRequestEventSchema,
	}),
	z.object({
		type: z.literal(TIMELINE_EVENT_TYPE.REVIEW_REQUEST_REMOVED),
		data: ReviewRequestEventSchema,
	}),
	z.object({ type: z.literal(TIMELINE_EVENT_TYPE.MILESTONED), data: MilestonedEventSchema }),
	z.object({ type: z.literal(TIMELINE_EVENT_TYPE.DEMILESTONED), data: MilestonedEventSchema }),
	z.object({ type: z.literal(TIMELINE_EVENT_TYPE.RENAMED), data: RenamedEventSchema }),
	z.object({ type: z.literal(TIMELINE_EVENT_TYPE.LOCKED), data: LockedEventSchema }),
	z.object({
		type: z.literal(TIMELINE_EVENT_TYPE.CROSS_REFERENCED),
		data: CrossReferencedEventSchema,
	}),
	z.object({ type: z.literal(TIMELINE_EVENT_TYPE.STATE_CHANGE), data: StateChangeEventSchema }),
	z.object({ type: z.literal(TIMELINE_EVENT_TYPE.DEPLOYED), data: DeployedEventSchema }),
	z.object({
		type: z.literal(TIMELINE_EVENT_TYPE.ADDED_TO_MERGE_QUEUE),
		data: MergeQueueEventSchema,
	}),
	z.object({
		type: z.literal(TIMELINE_EVENT_TYPE.REMOVED_FROM_MERGE_QUEUE),
		data: MergeQueueEventSchema,
	}),
]);
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;

/** Activity events — compact one-line timeline items (not comments, reviews, or commits). */
export type ActivityEvent = Exclude<
	TimelineEvent,
	| { type: typeof TIMELINE_EVENT_TYPE.ISSUE_COMMENT }
	| { type: typeof TIMELINE_EVENT_TYPE.REVIEW }
	| { type: typeof TIMELINE_EVENT_TYPE.COMMITTED }
>;

/** Discriminant values for activity events. */
export type ActivityEventType = ActivityEvent["type"];

// ─── Assembled timeline ───────────────────────────────────────────────────────

export const ResolvedThreadInfoSchema = z.object({ login: z.string() });
export type ResolvedThreadInfo = z.infer<typeof ResolvedThreadInfoSchema>;

export const ReactionDetailsSchema = z.object({
	/** Reactors for the pull request body, keyed by reaction content (e.g. "+1", "heart"). */
	pullRequest: ReactionUserMapSchema,
	/** Reactors for comments (issue + review), keyed by comment database ID. */
	comments: z.record(z.string(), ReactionUserMapSchema),
});
export type ReactionDetails = z.infer<typeof ReactionDetailsSchema>;

export const PullRequestTimelineSchema = z.object({
	events: z.array(TimelineEventSchema),
	reviewComments: z.array(TimelineReviewCommentSchema),
	/** Map from root comment ID to resolver info for threads resolved on GitHub. */
	resolvedThreads: z.record(z.string(), ResolvedThreadInfoSchema),
	/** Map from root comment database ID to the thread's GraphQL node ID. */
	threadNodeIds: z.record(z.string(), z.string()),
	reactionDetails: ReactionDetailsSchema,
});
export type PullRequestTimeline = z.infer<typeof PullRequestTimelineSchema>;

export const TimelineResponseSchema = z.object({ timeline: PullRequestTimelineSchema });
export type TimelineResponse = z.infer<typeof TimelineResponseSchema>;
