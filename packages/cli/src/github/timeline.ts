import {
	type PullRequestTimeline,
	REACTION_CONTENT,
	type ReactionContentKey,
	type ReactionDetails,
	type ReactionUserMap,
	type ResolvedThreadInfo,
	TIMELINE_EVENT_TYPE,
	type TimelineEvent,
	TimelineEventSchema,
	type TimelineEventType,
	type TimelineIssueComment,
	TimelineIssueCommentSchema,
	type TimelineReview,
	type TimelineReviewComment,
	TimelineReviewCommentSchema,
	TimelineReviewSchema,
	TimelineUserSchema,
} from "@stagereview/types";
import { REVIEW_STATE } from "@stagereview/types/pull-request";
import { z } from "zod";
import { ghReadOrThrow } from "./exec.js";
import type { GitHubRepo } from "./repo.js";

// Vendored from hosted Stage's `packages/github/src/conversation.ts`, adapted from
// Octokit to `gh api`: hosted trusts Octokit's response types where the CLI
// validates each raw event with the shared Zod wire schemas (which also strip the
// payload down to the fields the UI consumes).

/** Adds `body_html` alongside `body` so comment markdown renders like GitHub. */
const FULL_MEDIA_TYPE = "application/vnd.github.full+json";

/**
 * Maps GitHub's raw `event` field values to our TimelineEvent `type` discriminant.
 * Events not in this map are either handled specially (commented, reviewed,
 * review_dismissed) or ignored.
 */
const PASSTHROUGH_EVENT_MAP: Record<string, TimelineEventType> = {
	committed: TIMELINE_EVENT_TYPE.COMMITTED,
	labeled: TIMELINE_EVENT_TYPE.LABELED,
	unlabeled: TIMELINE_EVENT_TYPE.UNLABELED,
	assigned: TIMELINE_EVENT_TYPE.ASSIGNED,
	unassigned: TIMELINE_EVENT_TYPE.UNASSIGNED,
	review_requested: TIMELINE_EVENT_TYPE.REVIEW_REQUESTED,
	review_request_removed: TIMELINE_EVENT_TYPE.REVIEW_REQUEST_REMOVED,
	milestoned: TIMELINE_EVENT_TYPE.MILESTONED,
	demilestoned: TIMELINE_EVENT_TYPE.DEMILESTONED,
	renamed: TIMELINE_EVENT_TYPE.RENAMED,
	locked: TIMELINE_EVENT_TYPE.LOCKED,
	"cross-referenced": TIMELINE_EVENT_TYPE.CROSS_REFERENCED,
	// State change events share one schema but have different `event` values
	closed: TIMELINE_EVENT_TYPE.STATE_CHANGE,
	reopened: TIMELINE_EVENT_TYPE.STATE_CHANGE,
	merged: TIMELINE_EVENT_TYPE.STATE_CHANGE,
	head_ref_force_pushed: TIMELINE_EVENT_TYPE.STATE_CHANGE,
	convert_to_draft: TIMELINE_EVENT_TYPE.STATE_CHANGE,
	ready_for_review: TIMELINE_EVENT_TYPE.STATE_CHANGE,
	deployed: TIMELINE_EVENT_TYPE.DEPLOYED,
	added_to_merge_queue: TIMELINE_EVENT_TYPE.ADDED_TO_MERGE_QUEUE,
	removed_from_merge_queue: TIMELINE_EVENT_TYPE.REMOVED_FROM_MERGE_QUEUE,
};

const RawTimelineItemSchema = z.looseObject({ event: z.string() });

const ReviewDismissedEventSchema = z.object({
	dismissed_review: z.object({
		review_id: z.number(),
		state: z.string(),
		dismissal_message: z.string().nullable().optional(),
	}),
	actor: TimelineUserSchema,
	created_at: z.string(),
});

/** `--paginate --slurp` wraps every page into one JSON array (`[[…], […]]`). */
const PaginatedPagesSchema = z.array(z.array(z.unknown()));

async function fetchPaginated(repoRoot: string, endpoint: string): Promise<unknown[]> {
	const stdout = await ghReadOrThrow(
		["api", endpoint, "--paginate", "--slurp", "-H", `Accept: ${FULL_MEDIA_TYPE}`],
		repoRoot,
	);
	return PaginatedPagesSchema.parse(JSON.parse(stdout)).flat();
}

export interface TimelineResult {
	/** Comments and reviews need special processing (review-comment association) */
	comments: TimelineIssueComment[];
	reviews: TimelineReview[];
	/** Commits, activities, and other pass-through events — pre-typed as TimelineEvent */
	events: TimelineEvent[];
}

export async function getTimeline(
	repoRoot: string,
	repo: GitHubRepo,
	number: number,
): Promise<TimelineResult> {
	const data = await fetchPaginated(
		repoRoot,
		`repos/${repo.owner}/${repo.repo}/issues/${number}/timeline`,
	);

	const comments: TimelineIssueComment[] = [];
	const rawReviews: TimelineReview[] = [];
	const dismissals = new Map<number, TimelineReview["dismissal"]>();
	const events: TimelineEvent[] = [];

	for (const raw of data) {
		const item = RawTimelineItemSchema.safeParse(raw);
		if (!item.success) continue;

		if (item.data.event === "commented") {
			const comment = TimelineIssueCommentSchema.safeParse(raw);
			if (comment.success) comments.push(comment.data);
		} else if (item.data.event === "reviewed") {
			const review = TimelineReviewSchema.safeParse(raw);
			if (review.success) rawReviews.push(review.data);
		} else if (item.data.event === "review_dismissed") {
			const dismissed = ReviewDismissedEventSchema.safeParse(raw);
			if (dismissed.success) {
				dismissals.set(dismissed.data.dismissed_review.review_id, {
					original_state: dismissed.data.dismissed_review.state,
					actor: dismissed.data.actor,
					dismissal_message: dismissed.data.dismissed_review.dismissal_message ?? null,
					created_at: dismissed.data.created_at,
				});
			}
		} else {
			const type = PASSTHROUGH_EVENT_MAP[item.data.event];
			if (!type) continue;
			const event = TimelineEventSchema.safeParse({ type, data: raw });
			if (event.success) events.push(event.data);
		}
	}

	// Attach dismissal metadata to reviews
	const reviews: TimelineReview[] = rawReviews.map((review) => {
		if (review.state.toUpperCase() === REVIEW_STATE.DISMISSED) {
			const dismissal = dismissals.get(review.id);
			if (dismissal) return { ...review, dismissal };
		}
		return review;
	});

	return { comments, reviews, events };
}

export async function getReviewComments(
	repoRoot: string,
	repo: GitHubRepo,
	number: number,
): Promise<TimelineReviewComment[]> {
	const data = await fetchPaginated(
		repoRoot,
		`repos/${repo.owner}/${repo.repo}/pulls/${number}/comments`,
	);
	return data.flatMap((raw) => {
		const comment = TimelineReviewCommentSchema.safeParse(raw);
		return comment.success ? [comment.data] : [];
	});
}

// ─── Thread metadata (GraphQL) ────────────────────────────────────────────────

// Verbatim from hosted's `packages/github/src/graphql/conversation.graphql`.
const THREAD_METADATA_QUERY = `query GetThreadMetadata($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reactions(first: 100) { nodes { content user { login } } }
      comments(first: 100) {
        nodes { databaseId reactions(first: 100) { nodes { content user { login } } } }
      }
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          resolvedBy { login }
          comments(first: 100) {
            nodes { databaseId reactions(first: 10) { nodes { content user { login } } } }
          }
        }
      }
    }
  }
}`;

const ReactionNodeSchema = z
	.object({ content: z.string(), user: z.object({ login: z.string() }).nullable() })
	.nullable();
type ReactionNode = z.infer<typeof ReactionNodeSchema>;

const ReactionConnectionSchema = z.object({ nodes: z.array(ReactionNodeSchema).nullable() });

const MetadataCommentNodeSchema = z
	.object({ databaseId: z.number().nullable(), reactions: ReactionConnectionSchema })
	.nullable();

const ThreadMetadataResponseSchema = z.object({
	data: z.object({
		repository: z
			.object({
				pullRequest: z
					.object({
						reactions: ReactionConnectionSchema,
						comments: z.object({ nodes: z.array(MetadataCommentNodeSchema).nullable() }),
						reviewThreads: z.object({
							pageInfo: z.object({
								hasNextPage: z.boolean(),
								endCursor: z.string().nullable(),
							}),
							nodes: z
								.array(
									z
										.object({
											id: z.string(),
											isResolved: z.boolean(),
											resolvedBy: z.object({ login: z.string() }).nullable(),
											comments: z.object({
												nodes: z.array(MetadataCommentNodeSchema).nullable(),
											}),
										})
										.nullable(),
								)
								.nullable(),
						}),
					})
					.nullable(),
			})
			.nullable(),
	}),
});

const graphqlEnumToContentKey: ReadonlyMap<string, ReactionContentKey> = new Map(
	Object.entries(REACTION_CONTENT),
);

/** Groups a list of individual reaction nodes into a ReactionUserMap (content → logins). */
function groupReactionNodes(nodes: ReactionNode[]): ReactionUserMap {
	const userMap: ReactionUserMap = {};
	for (const node of nodes) {
		if (!node) continue;
		const key = graphqlEnumToContentKey.get(node.content);
		if (!key || !node.user) continue;
		const list = userMap[key];
		if (list) {
			list.push(node.user.login);
		} else {
			userMap[key] = [node.user.login];
		}
	}
	return userMap;
}

export interface ThreadMetadata {
	/** Keyed by root comment database ID (serialized as JSON object keys). */
	resolvedThreads: Record<string, ResolvedThreadInfo>;
	threadNodeIds: Record<string, string>;
	reactionDetails: ReactionDetails;
}

/**
 * Fetches pull request data only available via GraphQL: review thread resolved
 * status, thread node IDs, and reaction usernames for the pull request body,
 * issue comments, and review comments.
 *
 * Everything is fetched in a single paginated query. Review threads are paginated
 * (the only connection that can grow large); pull request body reactions and
 * issue comments are re-fetched on each page but are cheap and simply overwritten.
 */
export async function getThreadMetadata(
	repoRoot: string,
	repo: GitHubRepo,
	number: number,
): Promise<ThreadMetadata> {
	const resolvedThreads: Record<string, ResolvedThreadInfo> = {};
	const threadNodeIds: Record<string, string> = {};
	const commentReactions: Record<string, ReactionUserMap> = {};
	let pullRequestReactions: ReactionUserMap = {};
	let cursor: string | null = null;

	do {
		const args = [
			"api",
			"graphql",
			"-f",
			`query=${THREAD_METADATA_QUERY}`,
			// `-f` keeps string GraphQL variables as strings; `-F` would coerce a
			// repo/owner literally named `123` or `true` into the wrong type.
			// Only `number` (Int!) uses `-F`.
			"-f",
			`owner=${repo.owner}`,
			"-f",
			`repo=${repo.repo}`,
			"-F",
			`number=${number}`,
			...(cursor === null ? [] : ["-f", `cursor=${cursor}`]),
		];
		const stdout = await ghReadOrThrow(args, repoRoot);
		const result = ThreadMetadataResponseSchema.parse(JSON.parse(stdout));

		const pullRequest = result.data.repository?.pullRequest;
		if (!pullRequest) break;

		// Pull request body and issue comment reactions (overwritten each page, but cheap)
		pullRequestReactions = groupReactionNodes(pullRequest.reactions.nodes ?? []);
		for (const comment of pullRequest.comments.nodes ?? []) {
			if (!comment) continue;
			const userMap = groupReactionNodes(comment.reactions.nodes ?? []);
			if (Object.keys(userMap).length > 0 && comment.databaseId !== null) {
				commentReactions[comment.databaseId] = userMap;
			}
		}

		// Review thread resolved status, node IDs, and review comment reactions
		for (const thread of pullRequest.reviewThreads.nodes ?? []) {
			if (!thread) continue;
			const commentNodes = (thread.comments.nodes ?? []).filter(
				(node): node is NonNullable<typeof node> => node !== null,
			);
			const rootComment = commentNodes[0];
			if (rootComment && rootComment.databaseId !== null) {
				threadNodeIds[rootComment.databaseId] = thread.id;

				if (thread.isResolved && thread.resolvedBy) {
					resolvedThreads[rootComment.databaseId] = { login: thread.resolvedBy.login };
				}
			}

			for (const comment of commentNodes) {
				const userMap = groupReactionNodes(comment.reactions.nodes ?? []);
				if (Object.keys(userMap).length > 0 && comment.databaseId !== null) {
					commentReactions[comment.databaseId] = userMap;
				}
			}
		}

		cursor = pullRequest.reviewThreads.pageInfo.hasNextPage
			? pullRequest.reviewThreads.pageInfo.endCursor
			: null;
	} while (cursor);

	return {
		resolvedThreads,
		threadNodeIds,
		reactionDetails: {
			pullRequest: pullRequestReactions,
			comments: commentReactions,
		},
	};
}

// ─── Assembly ─────────────────────────────────────────────────────────────────

export function buildPullRequestTimeline(
	timeline: TimelineResult,
	reviewComments: TimelineReviewComment[],
	threadMetadata: ThreadMetadata,
): PullRequestTimeline {
	// Build a lookup from comment ID to its review ID, so we can find which review owns a parent
	const commentIdToReviewId = new Map<number, number>();
	for (const comment of reviewComments) {
		if (comment.pull_request_review_id != null) {
			commentIdToReviewId.set(comment.id, comment.pull_request_review_id);
		}
	}

	// Group review comments by their parent review ID.
	// Reply comments are reassigned to the review that owns their parent comment,
	// since GitHub creates separate reviews for inline replies.
	const commentsByReview = new Map<number, TimelineReviewComment[]>();
	for (const comment of reviewComments) {
		let targetReviewId = comment.pull_request_review_id;

		// If this is a reply, assign it to the review that owns the parent comment
		if (comment.in_reply_to_id != null) {
			const parentReviewId = commentIdToReviewId.get(comment.in_reply_to_id);
			if (parentReviewId != null) {
				targetReviewId = parentReviewId;
			}
		}

		if (targetReviewId != null) {
			const existing = commentsByReview.get(targetReviewId);
			if (existing) {
				existing.push(comment);
			} else {
				commentsByReview.set(targetReviewId, [comment]);
			}
		}
	}

	// Build timeline events: comments and reviews need processing,
	// everything else (commits, activities) is already pre-typed in timeline.events
	const events: TimelineEvent[] = [...timeline.events];

	for (const comment of timeline.comments) {
		events.push({ type: TIMELINE_EVENT_TYPE.ISSUE_COMMENT, data: comment });
	}

	for (const review of timeline.reviews) {
		const comments = commentsByReview.get(review.id) ?? [];
		const state = review.state.toUpperCase();

		// Skip empty "COMMENTED" reviews — GitHub creates these for inline comments/replies
		// that have been reassigned to their parent review above
		if (state === REVIEW_STATE.COMMENTED && !review.body && comments.length === 0) {
			continue;
		}

		events.push({ type: TIMELINE_EVENT_TYPE.REVIEW, data: review, comments });
	}

	// Sort by date ascending — timeline API returns events in order,
	// but we've split them into separate arrays, so re-sort after merging
	events.sort((a, b) => getEventDate(a).localeCompare(getEventDate(b)));

	return {
		events,
		reviewComments,
		resolvedThreads: threadMetadata.resolvedThreads,
		threadNodeIds: threadMetadata.threadNodeIds,
		reactionDetails: threadMetadata.reactionDetails,
	};
}

export function getEventDate(event: TimelineEvent): string {
	switch (event.type) {
		case TIMELINE_EVENT_TYPE.ISSUE_COMMENT:
			return event.data.created_at;
		case TIMELINE_EVENT_TYPE.REVIEW:
			return event.data.submitted_at ?? new Date(0).toISOString();
		case TIMELINE_EVENT_TYPE.COMMITTED:
			return event.data.author.date;
		default:
			// All activity events have created_at
			return event.data.created_at;
	}
}

/** Fetch and assemble the full pull-request timeline, mirroring hosted's endpoint. */
export async function getPullRequestTimeline(
	repoRoot: string,
	repo: GitHubRepo,
	number: number,
): Promise<PullRequestTimeline> {
	const [timeline, reviewComments, threadMetadata] = await Promise.all([
		getTimeline(repoRoot, repo, number),
		getReviewComments(repoRoot, repo, number),
		getThreadMetadata(repoRoot, repo, number),
	]);
	return buildPullRequestTimeline(timeline, reviewComments, threadMetadata);
}
