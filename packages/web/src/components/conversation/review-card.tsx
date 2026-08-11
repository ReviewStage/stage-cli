import type {
	ReactionDetails,
	ResolvedThreadInfo,
	TimelineReview,
	TimelineReviewComment,
} from "@stagereview/types";
import { REVIEW_STATE, type ReviewState } from "@stagereview/types";
import {
	Check,
	ChevronRight,
	CircleCheck,
	Eye,
	FileDiff,
	type LucideIcon,
	MessageSquare,
	X,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { UserName } from "@/components/shared/user-name";
import { getUserDisplay } from "@/components/shared/user-utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { toast } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SUBJECT_TYPE } from "@/lib/diff-types";
import { formatTimeAgo } from "@/lib/format";
import { CommentBody } from "./comment-body";
import { CommentHeader } from "./comment-header";
import { normalizeReviewComments, type Thread, type ThreadReply } from "./normalize-threads";
import { ReactionBar } from "./reaction-bar";
import { ReviewCommentDiffPreview } from "./review-comment-diff-preview";

// `isolate` on the thread file header keeps its z-10 layers below the sticky
// Discussion header. Read-only: reply/resolve/edit mutations are not
// supported — resolved state renders as an indicator instead of a toggle, and
// review bodies are not editable.

const REVIEW_STATE_CONFIG: Record<
	ReviewState,
	{
		actionText: string;
		icon: LucideIcon;
		circleClassName: string;
	}
> = {
	APPROVED: {
		actionText: "approved these changes",
		icon: Check,
		circleClassName: "bg-green-500 text-white",
	},
	CHANGES_REQUESTED: {
		actionText: "requested changes",
		icon: FileDiff,
		circleClassName: "bg-red-500 text-white",
	},
	COMMENTED: {
		actionText: "reviewed",
		icon: Eye,
		circleClassName: "bg-muted text-muted-foreground",
	},
	DISMISSED: {
		actionText: "previously reviewed",
		icon: Eye,
		circleClassName: "bg-muted text-muted-foreground",
	},
	PENDING: {
		actionText: "pending review",
		icon: MessageSquare,
		circleClassName: "bg-muted text-muted-foreground",
	},
};

/** For dismissed reviews, derive the display from the original state before dismissal. */
const DISMISSED_ACTION_TEXT: Partial<Record<ReviewState, string>> = {
	CHANGES_REQUESTED: "previously requested changes",
	APPROVED: "previously approved these changes",
	COMMENTED: "previously reviewed",
};

function isReviewState(value: string): value is ReviewState {
	return value in REVIEW_STATE_CONFIG;
}

function formatThreadLineLabel(thread: Thread): string {
	// The label describes the diff preview below it, so it must use the
	// preview's frozen original coordinates — thread.line/startLine are
	// remapped as the PR head advances and can point elsewhere.
	const { line, startLine } = thread.diffPreview ?? thread;
	if (thread.subjectType === SUBJECT_TYPE.FILE || line == null) return "File comment";
	if (startLine != null && startLine !== line) {
		const start = Math.min(startLine, line);
		const end = Math.max(startLine, line);
		return `lines ${start}-${end}`;
	}
	return `line ${line}`;
}

function CopyableFilename({ path, label }: { path: string; label: string }) {
	const copyPath = useCallback(() => {
		navigator.clipboard.writeText(path).then(
			() => {
				toast.success(`Copied ${label} to clipboard`);
			},
			(error: unknown) => {
				console.error("Failed to copy filename", error);
			},
		);
	}, [path, label]);

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					onClick={(event) => {
						event.stopPropagation();
						copyPath();
					}}
					className="min-w-0 cursor-pointer truncate rounded px-1 py-0.5 transition-colors hover:bg-black/10 dark:hover:bg-white/10"
					aria-label={`Copy ${label}`}
				>
					{path}
				</button>
			</TooltipTrigger>
			<TooltipContent side="top">Copy {label}</TooltipContent>
		</Tooltip>
	);
}

function ResolvedIndicator({ thread }: { thread: Thread }) {
	if (!thread.isResolved) return null;
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span className="flex size-6 items-center justify-center">
					<CircleCheck className="size-3.5 text-green-600" />
				</span>
			</TooltipTrigger>
			<TooltipContent>
				{thread.resolvedBy ? `Resolved by ${thread.resolvedBy.login}` : "Resolved"}
			</TooltipContent>
		</Tooltip>
	);
}

function ReviewThreadFileHeader({
	thread,
	isOpen,
	onToggle,
}: {
	thread: Thread;
	isOpen: boolean;
	onToggle: () => void;
}) {
	return (
		<div className="group/review-thread-file relative isolate flex w-full items-center gap-2 bg-muted/40 px-3 py-2 text-left transition-colors">
			<button
				type="button"
				onClick={onToggle}
				aria-label={`${isOpen ? "Collapse" : "Expand"} ${thread.path}`}
				aria-expanded={isOpen}
				className="absolute inset-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
			/>
			<button
				type="button"
				tabIndex={-1}
				onClick={(event) => {
					event.stopPropagation();
					onToggle();
				}}
				className="-ml-1 relative z-10 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				aria-label={isOpen ? "Collapse review comment" : "Expand review comment"}
			>
				<ChevronRight
					className={`size-4 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
				/>
			</button>
			<span className="relative z-10 flex min-w-0 items-center font-mono text-foreground text-xs">
				<CopyableFilename path={thread.path} label="filename" />
			</span>
			<span className="relative z-10 shrink-0 text-muted-foreground text-xs tabular-nums">
				{formatThreadLineLabel(thread)}
			</span>
			<div className="flex-1" />
			<div className="relative z-10 flex shrink-0 items-center gap-0.5">
				<ResolvedIndicator thread={thread} />
			</div>
		</div>
	);
}

function ThreadReplyItem({
	reply,
	reactionDetails,
}: {
	reply: ThreadReply;
	reactionDetails?: ReactionDetails;
}) {
	return (
		<CommentHeader user={reply.user} createdAt={reply.createdAt} htmlUrl={reply.htmlUrl} size="sm">
			<CommentBody body={reply.body} bodyHtml={reply.bodyHtml} />
			<ReactionBar reactions={reactionDetails?.comments[reply.id]} />
		</CommentHeader>
	);
}

function ThreadBody({
	thread,
	reactionDetails,
}: {
	thread: Thread;
	reactionDetails?: ReactionDetails;
}) {
	return (
		<>
			<CommentBody body={thread.body} bodyHtml={thread.bodyHtml} />
			<ReactionBar reactions={reactionDetails?.comments[thread.id]} />

			{thread.replies.length > 0 && (
				<div className="mt-3 space-y-3 border-border/50 border-l-2 pl-4">
					{thread.replies.map((reply) => (
						<ThreadReplyItem key={reply.nodeId} reply={reply} reactionDetails={reactionDetails} />
					))}
				</div>
			)}
		</>
	);
}

/** Shared thread header row: avatar, username, timestamp link. */
function ThreadHeader({ thread }: { thread: Thread }) {
	const { profileUrl } = getUserDisplay(thread.user);
	return (
		<div className="flex items-center gap-2">
			<a href={profileUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
				<Avatar className="size-5">
					<AvatarImage src={thread.user.avatar_url} alt={thread.user.login} />
					<AvatarFallback className="text-[0.625rem]">
						{thread.user.login[0]?.toUpperCase()}
					</AvatarFallback>
				</Avatar>
			</a>
			<p className="min-w-0 flex-1 text-muted-foreground text-sm">
				<UserName user={thread.user} />{" "}
				<a
					href={thread.htmlUrl}
					target="_blank"
					rel="noopener noreferrer"
					className="hover:underline"
					aria-label={`View comment by ${thread.user.login} on GitHub`}
				>
					<time dateTime={thread.createdAt} title={new Date(thread.createdAt).toLocaleString()}>
						{formatTimeAgo(thread.createdAt)}
					</time>
				</a>
			</p>
		</div>
	);
}

export function ReviewThreadItem({
	thread,
	reactionDetails,
}: {
	thread: Thread;
	reactionDetails?: ReactionDetails;
}) {
	const [isOpen, setIsOpen] = useState(!thread.isResolved);

	return (
		<Collapsible open={isOpen} onOpenChange={setIsOpen}>
			<div className="overflow-hidden rounded-lg border border-border bg-card">
				<ReviewThreadFileHeader
					thread={thread}
					isOpen={isOpen}
					onToggle={() => setIsOpen((open) => !open)}
				/>
				<CollapsibleContent className="border-border border-t">
					<ReviewCommentDiffPreview thread={thread} />
					<div className="border-border/60 border-t px-3 py-3">
						<ThreadHeader thread={thread} />
						<div className="mt-2">
							<ThreadBody thread={thread} reactionDetails={reactionDetails} />
						</div>
					</div>
				</CollapsibleContent>
			</div>
		</Collapsible>
	);
}

interface ReviewCardProps {
	review: TimelineReview;
	comments: TimelineReviewComment[];
	resolvedThreads?: Map<number, ResolvedThreadInfo>;
	reactionDetails?: ReactionDetails;
	hideResolved?: boolean;
}

export function ReviewCard({
	review,
	comments,
	resolvedThreads,
	reactionDetails,
	hideResolved,
}: ReviewCardProps) {
	const state = review.state.toUpperCase();
	const isDismissed = state === REVIEW_STATE.DISMISSED;
	const originalState = review.dismissal?.original_state.toUpperCase();
	const resolvedOriginalState =
		originalState && isReviewState(originalState) ? originalState : null;

	// For dismissed reviews, use the original state's icon/color but with the "previously ..." text
	const displayState = isDismissed && resolvedOriginalState ? resolvedOriginalState : state;
	const config = isReviewState(displayState)
		? REVIEW_STATE_CONFIG[displayState]
		: REVIEW_STATE_CONFIG.COMMENTED;
	const actionText =
		isDismissed && resolvedOriginalState
			? (DISMISSED_ACTION_TEXT[resolvedOriginalState] ?? config.actionText)
			: config.actionText;
	const Icon = config.icon;

	const threads = useMemo(() => {
		const all = normalizeReviewComments(comments, resolvedThreads);
		if (hideResolved) return all.filter((thread) => !thread.isResolved);
		return all;
	}, [comments, resolvedThreads, hideResolved]);

	return (
		<CommentHeader
			user={review.user}
			createdAt={review.submitted_at ?? new Date(0).toISOString()}
			htmlUrl={review.html_url}
			icon={
				<span
					className={`flex size-6 items-center justify-center rounded-full ${config.circleClassName}`}
				>
					<Icon className="size-3" />
				</span>
			}
			action={actionText}
		>
			{review.body && <CommentBody body={review.body} bodyHtml={review.body_html} />}

			{threads.length > 0 && (
				<div className="mt-3 space-y-3 border-border/50 border-l-2 pl-4">
					{threads.map((thread) => (
						<ReviewThreadItem
							key={thread.nodeId}
							thread={thread}
							reactionDetails={reactionDetails}
						/>
					))}
				</div>
			)}

			{review.dismissal && (
				<div className="mt-3 flex items-start gap-2 text-muted-foreground text-sm">
					<span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
						<X className="size-3" />
					</span>
					<Avatar className="mt-0.5 size-5 shrink-0">
						<AvatarImage
							src={review.dismissal.actor.avatar_url}
							alt={review.dismissal.actor.login}
						/>
						<AvatarFallback className="text-[0.625rem]">
							{review.dismissal.actor.login[0]?.toUpperCase()}
						</AvatarFallback>
					</Avatar>
					<div className="min-w-0">
						<p>
							<UserName user={review.dismissal.actor} /> dismissed <UserName user={review.user} />
							&apos;s stale review{" "}
							<time
								dateTime={review.dismissal.created_at}
								title={new Date(review.dismissal.created_at).toLocaleString()}
								className="text-muted-foreground"
							>
								{formatTimeAgo(review.dismissal.created_at)}
							</time>
						</p>
						{review.dismissal.dismissal_message && (
							<blockquote className="mt-1 border-border/50 border-l-2 pl-3 text-sm">
								{review.dismissal.dismissal_message}
							</blockquote>
						)}
					</div>
				</div>
			)}
		</CommentHeader>
	);
}
