import {
	type ActivityEvent,
	type ActivityEventType,
	STATE_CHANGE_EVENT,
	type StateChangeEventName,
	TIMELINE_EVENT_TYPE,
} from "@stagereview/types";
import {
	CircleDot,
	Clock4,
	Eye,
	EyeOff,
	GitCommitHorizontal,
	GitMerge,
	GitPullRequest,
	GitPullRequestClosed,
	GitPullRequestDraft,
	Lock,
	type LucideIcon,
	Milestone,
	Pencil,
	Rocket,
	Tag,
	UserMinus,
	UserPlus,
} from "lucide-react";
import { UserName } from "@/components/shared/user-name";
import type { GitHubUser } from "@/components/shared/user-utils";
import { formatTimeAgo } from "@/lib/format";

const MUTED_ICON_CLASS = "bg-muted text-muted-foreground";

interface IconConfig {
	icon: LucideIcon;
	iconClassName: string;
}

/** Static icon for every non-state-change event type (all use the muted style). */
const EVENT_ICONS: Record<Exclude<ActivityEventType, "state_change">, LucideIcon> = {
	labeled: Tag,
	unlabeled: Tag,
	assigned: UserPlus,
	unassigned: UserMinus,
	review_requested: Eye,
	review_request_removed: EyeOff,
	milestoned: Milestone,
	demilestoned: Milestone,
	renamed: Pencil,
	locked: Lock,
	cross_referenced: CircleDot,
	deployed: Rocket,
	added_to_merge_queue: Clock4,
	removed_from_merge_queue: Clock4,
};

/** State-change sub-types have varying icons and colours. */
const STATE_CHANGE_ICONS: Record<StateChangeEventName, IconConfig> = {
	[STATE_CHANGE_EVENT.MERGED]: { icon: GitMerge, iconClassName: "bg-purple-500 text-white" },
	[STATE_CHANGE_EVENT.CLOSED]: {
		icon: GitPullRequestClosed,
		iconClassName: "bg-red-500 text-white",
	},
	[STATE_CHANGE_EVENT.REOPENED]: {
		icon: GitPullRequest,
		iconClassName: "bg-green-500 text-white",
	},
	[STATE_CHANGE_EVENT.HEAD_REF_FORCE_PUSHED]: {
		icon: GitCommitHorizontal,
		iconClassName: MUTED_ICON_CLASS,
	},
	[STATE_CHANGE_EVENT.READY_FOR_REVIEW]: {
		icon: GitPullRequest,
		iconClassName: "bg-green-500 text-white",
	},
	[STATE_CHANGE_EVENT.CONVERT_TO_DRAFT]: {
		icon: GitPullRequestDraft,
		iconClassName: MUTED_ICON_CLASS,
	},
};

const STATE_CHANGE_CONTENT: Record<StateChangeEventName, string> = {
	[STATE_CHANGE_EVENT.MERGED]: "merged this pull request",
	[STATE_CHANGE_EVENT.CLOSED]: "closed this",
	[STATE_CHANGE_EVENT.REOPENED]: "reopened this",
	[STATE_CHANGE_EVENT.HEAD_REF_FORCE_PUSHED]: "force-pushed the branch",
	[STATE_CHANGE_EVENT.READY_FOR_REVIEW]: "marked this pull request as ready for review",
	[STATE_CHANGE_EVENT.CONVERT_TO_DRAFT]: "converted this pull request to draft",
};

function getIconConfig(event: ActivityEvent): IconConfig {
	if (event.type === TIMELINE_EVENT_TYPE.STATE_CHANGE) {
		return STATE_CHANGE_ICONS[event.data.event];
	}
	return { icon: EVENT_ICONS[event.type], iconClassName: MUTED_ICON_CLASS };
}

interface MergeQueueContext {
	repoUrl: string;
	baseBranch: string;
}

/** Exhaustive switch narrows `event` per-branch — no type assertion needed. */
function getContent(event: ActivityEvent, mergeQueue?: MergeQueueContext): React.ReactNode {
	switch (event.type) {
		case TIMELINE_EVENT_TYPE.LABELED:
			return (
				<>
					added the <LabelBadge name={event.data.label.name} color={event.data.label.color} /> label
				</>
			);
		case TIMELINE_EVENT_TYPE.UNLABELED:
			return (
				<>
					removed the <LabelBadge name={event.data.label.name} color={event.data.label.color} />{" "}
					label
				</>
			);
		case TIMELINE_EVENT_TYPE.ASSIGNED:
			return (
				<>
					assigned <UserName user={event.data.assignee} />
				</>
			);
		case TIMELINE_EVENT_TYPE.UNASSIGNED:
			return (
				<>
					unassigned <UserName user={event.data.assignee} />
				</>
			);
		case TIMELINE_EVENT_TYPE.REVIEW_REQUESTED:
			return event.data.requested_reviewer ? (
				<>
					requested a review from <UserName user={event.data.requested_reviewer} />
				</>
			) : event.data.requested_team ? (
				<>
					requested a review from <strong>{event.data.requested_team.name}</strong>
				</>
			) : (
				<>requested a review</>
			);
		case TIMELINE_EVENT_TYPE.REVIEW_REQUEST_REMOVED:
			return event.data.requested_reviewer ? (
				<>
					removed review request for <UserName user={event.data.requested_reviewer} />
				</>
			) : event.data.requested_team ? (
				<>
					removed review request for <strong>{event.data.requested_team.name}</strong>
				</>
			) : (
				<>removed a review request</>
			);
		case TIMELINE_EVENT_TYPE.MILESTONED:
			return (
				<>
					added this to the <strong>{event.data.milestone.title}</strong> milestone
				</>
			);
		case TIMELINE_EVENT_TYPE.DEMILESTONED:
			return (
				<>
					removed this from the <strong>{event.data.milestone.title}</strong> milestone
				</>
			);
		case TIMELINE_EVENT_TYPE.RENAMED:
			return (
				<>
					changed the title <span className="line-through">{event.data.rename.from}</span>{" "}
					<strong>{event.data.rename.to}</strong>
				</>
			);
		case TIMELINE_EVENT_TYPE.LOCKED:
			return (
				<>
					locked{event.data.lock_reason ? ` as ${event.data.lock_reason}` : ""} and limited
					conversation to collaborators
				</>
			);
		case TIMELINE_EVENT_TYPE.CROSS_REFERENCED:
			return event.data.source.issue ? (
				<>
					mentioned this in{" "}
					<a
						href={event.data.source.issue.html_url}
						target="_blank"
						rel="noopener noreferrer"
						className="font-medium text-foreground hover:underline"
					>
						{event.data.source.issue.title}
					</a>
				</>
			) : (
				<>mentioned this</>
			);
		case TIMELINE_EVENT_TYPE.STATE_CHANGE:
			return <>{STATE_CHANGE_CONTENT[event.data.event]}</>;
		case TIMELINE_EVENT_TYPE.DEPLOYED:
			return <>deployed this</>;
		case TIMELINE_EVENT_TYPE.ADDED_TO_MERGE_QUEUE:
			return (
				<>
					added this pull request to the{" "}
					{mergeQueue ? (
						<a
							href={`${mergeQueue.repoUrl}/queue/${mergeQueue.baseBranch}`}
							target="_blank"
							rel="noopener noreferrer"
							className="font-medium text-foreground hover:underline"
						>
							merge queue
						</a>
					) : (
						"merge queue"
					)}
				</>
			);
		case TIMELINE_EVENT_TYPE.REMOVED_FROM_MERGE_QUEUE:
			return (
				<>
					removed this pull request from the{" "}
					{mergeQueue ? (
						<a
							href={`${mergeQueue.repoUrl}/queue/${mergeQueue.baseBranch}`}
							target="_blank"
							rel="noopener noreferrer"
							className="font-medium text-foreground hover:underline"
						>
							merge queue
						</a>
					) : (
						"merge queue"
					)}
				</>
			);
	}
}

function getActor(event: ActivityEvent): GitHubUser | null {
	if (event.type === TIMELINE_EVENT_TYPE.CROSS_REFERENCED) {
		return event.data.actor ?? null;
	}
	return event.data.actor;
}

function LabelBadge({ name, color }: { name: string; color: string }) {
	return (
		<span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 font-medium text-xs">
			<span className="inline-block size-2 rounded-full" style={{ backgroundColor: `#${color}` }} />
			{name}
		</span>
	);
}

interface EventItemProps {
	event: ActivityEvent;
	/** GitHub URL for the event (e.g. pull request html_url + #event-{id}). */
	eventUrl?: string;
	/** Context for linking "merge queue" text to GitHub's queue page. */
	mergeQueue?: MergeQueueContext;
}

export function EventItem({ event, eventUrl, mergeQueue }: EventItemProps) {
	const { icon: Icon, iconClassName } = getIconConfig(event);
	const actor = getActor(event);

	const timestamp = (
		<time dateTime={event.data.created_at} title={new Date(event.data.created_at).toLocaleString()}>
			{formatTimeAgo(event.data.created_at)}
		</time>
	);

	return (
		<div className="flex items-start gap-3">
			<span
				className={`flex size-6 shrink-0 items-center justify-center rounded-full ${iconClassName}`}
			>
				<Icon className="size-3" />
			</span>
			<div className="min-w-0 flex-1 text-muted-foreground text-sm">
				{actor && (
					<>
						<UserName user={actor} />{" "}
					</>
				)}
				{getContent(event, mergeQueue)}{" "}
				{eventUrl ? (
					<a href={eventUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
						{timestamp}
					</a>
				) : (
					timestamp
				)}
			</div>
		</div>
	);
}
