import type { ReactionDetails, ResolvedThreadInfo } from "@stagereview/types";
import { TIMELINE_EVENT_TYPE, type TimelineEvent } from "@stagereview/types";
import { MessageSquare } from "lucide-react";
import { useMemo } from "react";
import { getUserDisplay } from "@/components/shared/user-utils";
import { CommentCard } from "./comment-card";
import { normalizeReviewComments } from "./normalize-threads";
import { ReviewCard } from "./review-card";

type DiscussionEvent = Extract<
	TimelineEvent,
	{ type: typeof TIMELINE_EVENT_TYPE.ISSUE_COMMENT | typeof TIMELINE_EVENT_TYPE.REVIEW }
>;

export function isDiscussionEvent(event: TimelineEvent): event is DiscussionEvent {
	return (
		event.type === TIMELINE_EVENT_TYPE.ISSUE_COMMENT || event.type === TIMELINE_EVENT_TYPE.REVIEW
	);
}

export interface DiscussionFilters {
	hideResolved: boolean;
	hideBots: boolean;
}

interface DiscussionTimelineProps {
	events: TimelineEvent[];
	resolvedThreads: Map<number, ResolvedThreadInfo>;
	reactionDetails?: ReactionDetails;
	filters: DiscussionFilters;
}

export function DiscussionTimeline({
	events,
	resolvedThreads,
	reactionDetails,
	filters,
}: DiscussionTimelineProps) {
	const discussionEvents = useFilteredDiscussionEvents(events, resolvedThreads, filters);

	const hasActiveFilter = filters.hideResolved || filters.hideBots;
	const emptyMessage = hasActiveFilter ? "No matching comments" : "No comments yet";

	if (discussionEvents.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center py-8 text-center">
				<MessageSquare className="mb-2 size-8 text-muted-foreground/30" />
				<p className="text-muted-foreground text-sm">{emptyMessage}</p>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{discussionEvents.map((event) => {
				if (event.type === TIMELINE_EVENT_TYPE.ISSUE_COMMENT) {
					const app = event.data.performed_via_github_app;
					return (
						<div key={event.data.id} className="rounded-xl border border-border bg-card px-4 py-4">
							<CommentCard
								user={event.data.user}
								body={event.data.body ?? ""}
								bodyHtml={event.data.body_html}
								createdAt={event.data.created_at}
								updatedAt={event.data.updated_at}
								htmlUrl={event.data.html_url}
								reactions={reactionDetails?.comments[event.data.id]}
								appAvatarUrl={
									app ? `https://avatars.githubusercontent.com/in/${app.id}` : undefined
								}
								appUrl={app?.slug ? `https://github.com/apps/${app.slug}` : undefined}
							/>
						</div>
					);
				}

				return (
					<div key={event.data.id} className="rounded-xl border border-border bg-card px-4 py-4">
						<ReviewCard
							review={event.data}
							comments={event.comments}
							resolvedThreads={resolvedThreads}
							reactionDetails={reactionDetails}
							hideResolved={filters.hideResolved}
						/>
					</div>
				);
			})}
		</div>
	);
}

/**
 * Filters discussion events based on active filters:
 *
 * "Hide resolved":
 * - Issue comments (human): visible
 * - Issue comments (bot): visible
 * - Reviews with unresolved threads: visible (only unresolved threads rendered by ReviewCard)
 * - Reviews with all threads resolved: hidden
 * - Reviews with no threads (human): visible (e.g. approvals)
 * - Reviews with no threads (bot): visible
 *
 * "Hide bots":
 * - Issue comments (bot): hidden
 * - All bot reviews: hidden
 */
function useFilteredDiscussionEvents(
	events: TimelineEvent[],
	resolvedThreads: Map<number, ResolvedThreadInfo>,
	filters: DiscussionFilters,
): DiscussionEvent[] {
	return useMemo(() => {
		const all = events.filter(isDiscussionEvent);
		if (!filters.hideResolved && !filters.hideBots) return all;

		return all.filter((event) => {
			const { isBot } = getUserDisplay(event.data.user);

			if (event.type === TIMELINE_EVENT_TYPE.ISSUE_COMMENT) {
				if (filters.hideBots && isBot) return false;
				return true;
			}

			// "Hide bots" hides all bot reviews
			if (filters.hideBots && isBot) return false;

			if (!filters.hideResolved) return true;

			// Reviews with no threads (approvals, bot summaries, etc.) are always visible
			if (event.comments.length === 0) return true;

			// Hide reviews where every thread is resolved
			const threads = normalizeReviewComments(event.comments, resolvedThreads);
			return threads.some((thread) => !thread.isResolved);
		});
	}, [events, resolvedThreads, filters.hideResolved, filters.hideBots]);
}
