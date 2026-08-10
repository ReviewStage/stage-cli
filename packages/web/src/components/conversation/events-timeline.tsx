import type { GitHubPullRequest } from "@stagereview/types";
import {
	type ActivityEvent,
	TIMELINE_EVENT_TYPE,
	type TimelineCommittedEvent,
	type TimelineEvent,
} from "@stagereview/types";
import { Clock } from "lucide-react";
import { CommitGroup } from "./commit-group";
import { EventItem } from "./event-item";

function eventKey(event: ActivityEvent): string | number {
	if ("id" in event.data && typeof event.data.id === "number") return event.data.id;
	return `${event.type}-${event.data.created_at}`;
}

type NonDiscussionEvent = Exclude<
	TimelineEvent,
	{ type: typeof TIMELINE_EVENT_TYPE.ISSUE_COMMENT | typeof TIMELINE_EVENT_TYPE.REVIEW }
>;

function isNonDiscussionEvent(event: TimelineEvent): event is NonDiscussionEvent {
	return (
		event.type !== TIMELINE_EVENT_TYPE.ISSUE_COMMENT && event.type !== TIMELINE_EVENT_TYPE.REVIEW
	);
}

function isActivityEvent(event: NonDiscussionEvent): event is ActivityEvent {
	return event.type !== TIMELINE_EVENT_TYPE.COMMITTED;
}

type EventGroup =
	| { kind: "commits"; commits: TimelineCommittedEvent[] }
	| { kind: "events"; events: ActivityEvent[] };

function groupEvents(events: NonDiscussionEvent[]): EventGroup[] {
	const groups: EventGroup[] = [];

	for (const event of events) {
		if (event.type === TIMELINE_EVENT_TYPE.COMMITTED) {
			const last = groups[groups.length - 1];
			if (last?.kind === "commits") {
				last.commits.push(event.data);
			} else {
				groups.push({ kind: "commits", commits: [event.data] });
			}
		} else if (isActivityEvent(event)) {
			const last = groups[groups.length - 1];
			if (last?.kind === "events") {
				last.events.push(event);
			} else {
				groups.push({ kind: "events", events: [event] });
			}
		}
	}

	return groups;
}

/**
 * Base repository URL derived from the PR's html_url. Hosted reads
 * `pullRequest.base.repo.html_url`; the CLI's leaner PR shape doesn't carry the
 * repo object, but the PR URL always embeds it.
 */
function repoUrlFromPullRequest(pullRequest: GitHubPullRequest): string {
	return pullRequest.html_url.replace(/\/pull\/\d+.*$/, "");
}

interface EventsTimelineProps {
	pullRequest: GitHubPullRequest;
	events: TimelineEvent[];
}

export function EventsTimeline({ pullRequest, events }: EventsTimelineProps) {
	const nonDiscussionEvents = events.filter(isNonDiscussionEvent);

	if (nonDiscussionEvents.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center py-8 text-center">
				<Clock className="mb-2 size-8 text-muted-foreground/30" />
				<p className="text-muted-foreground text-sm">No events yet</p>
			</div>
		);
	}

	const repoUrl = repoUrlFromPullRequest(pullRequest);
	const groups = groupEvents(nonDiscussionEvents);

	return (
		<div className="space-y-4">
			{groups.map((group) => {
				if (group.kind === "commits") {
					const firstCommit = group.commits[0];
					if (!firstCommit) return null;
					return (
						<div
							key={firstCommit.sha}
							className="rounded-xl border border-border bg-card px-4 py-4"
						>
							<CommitGroup commits={group.commits} repoUrl={repoUrl} />
						</div>
					);
				}

				const firstEvent = group.events[0];
				if (!firstEvent) return null;
				return (
					<div
						key={eventKey(firstEvent)}
						className="rounded-xl border border-border bg-card px-4 py-4"
					>
						<div className="space-y-2">
							{group.events.map((event) => {
								const isMergeQueueEvent =
									event.type === TIMELINE_EVENT_TYPE.ADDED_TO_MERGE_QUEUE ||
									event.type === TIMELINE_EVENT_TYPE.REMOVED_FROM_MERGE_QUEUE;
								const eventId = "id" in event.data ? event.data.id : undefined;
								return (
									<EventItem
										key={eventKey(event)}
										event={event}
										eventUrl={
											eventId !== undefined
												? `${repoUrl}/pull/${pullRequest.number}#event-${eventId}`
												: undefined
										}
										mergeQueue={
											isMergeQueueEvent ? { repoUrl, baseBranch: pullRequest.base.ref } : undefined
										}
									/>
								);
							})}
						</div>
					</div>
				);
			})}
		</div>
	);
}
