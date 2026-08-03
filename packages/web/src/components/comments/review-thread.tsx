import {
	COMMENT_STATE,
	type ReviewComment,
	type ReviewThread,
	THREAD_SOURCE,
} from "@stagereview/types/review";
import {
	ChevronRight,
	Circle,
	CircleCheck,
	GitPullRequestArrow,
	MessageSquare,
	User,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Markdown } from "@/components/ui/markdown";
import { toast } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCommentPreferences } from "@/lib/comment-preferences";
import { formatTimeAgo } from "@/lib/format";
import { useReviewContext } from "@/lib/review-context";
import { GITHUB_REVIEW_STATUS } from "@/lib/use-review";
import { useViewer } from "@/lib/use-viewer";
import { cn } from "@/lib/utils";
import { CommentActions } from "./comment-actions";
import { CommentForm } from "./comment-form";

function errorMessage(err: unknown, fallback: string): string {
	return err instanceof Error ? err.message : fallback;
}

const PENDING_BADGE_CN =
	"border-yellow-500/50 bg-yellow-50 text-yellow-800 dark:bg-yellow-950/20 dark:text-yellow-200";

// Local comments remain editable offline. A pending GitHub comment is editable
// only while this run can write to the current pending review.
export function canEditReviewComment(comment: ReviewComment, canPushToReview: boolean): boolean {
	return (
		comment.state === COMMENT_STATE.LOCAL ||
		(comment.state === COMMENT_STATE.PENDING && canPushToReview)
	);
}

export function activeEditingCommentId(
	comments: ReviewComment[],
	editingId: string | null,
	canPushToReview: boolean,
): string | null {
	if (editingId === null) return null;
	const comment = comments.find((candidate) => candidate.id === editingId);
	return comment && canEditReviewComment(comment, canPushToReview) ? editingId : null;
}

function StateBadge({ state }: { state: ReviewComment["state"] }) {
	if (state === COMMENT_STATE.PENDING) {
		return (
			<Badge
				variant="outline"
				className={cn("shrink-0 text-[10px] leading-none", PENDING_BADGE_CN)}
			>
				Pending
			</Badge>
		);
	}
	if (state === COMMENT_STATE.LOCAL) {
		return (
			<Badge variant="secondary" className="shrink-0 text-[10px] leading-none">
				Local
			</Badge>
		);
	}
	return null;
}

export function threadChevronClassName(isOpen: boolean): string {
	return cn("size-3.5 transition-transform duration-200", isOpen && "rotate-90");
}

export function canPublishReplyImmediately(thread: ReviewThread): boolean {
	return thread.comments.some((comment) => comment.state === COMMENT_STATE.SUBMITTED);
}

export function canReplyToGitHubThread(
	thread: ReviewThread,
	canWriteToGitHub: boolean,
	canPushToReview: boolean,
): boolean {
	return (
		thread.source === THREAD_SOURCE.GITHUB &&
		thread.viewerCanReply &&
		canWriteToGitHub &&
		(canPushToReview || canPublishReplyImmediately(thread))
	);
}

export function canToggleThreadResolution(
	thread: ReviewThread,
	canWriteToGitHub: boolean,
): boolean {
	if (thread.source === THREAD_SOURCE.LOCAL) return true;
	if (!canWriteToGitHub) return false;
	return thread.isResolved ? thread.viewerCanUnresolve : thread.viewerCanResolve;
}

export function canAddLocalThreadToReview(
	thread: ReviewThread,
	githubAvailable: boolean,
	canPushToReview: boolean,
	githubAnchorEligible: boolean,
): boolean {
	return (
		thread.source === THREAD_SOURCE.LOCAL &&
		githubAvailable &&
		(thread.hasPromotionRecovery || (canPushToReview && githubAnchorEligible))
	);
}

export function activeReplyingState(isReplying: boolean, canReply: boolean): boolean {
	return isReplying && canReply;
}

export function deleteRemovesReplies(thread: ReviewThread, comment: ReviewComment): boolean {
	return thread.comments.length > 1 && thread.comments[0]?.id === comment.id;
}

interface ReviewThreadViewModel {
	thread: ReviewThread;
	githubAnchorEligible: boolean;
}

export function ReviewThreadView({ model }: { model: ReviewThreadViewModel }) {
	const { thread, githubAnchorEligible } = model;
	const review = useReviewContext();
	const isGitHub = thread.source === THREAD_SOURCE.GITHUB;
	const githubAvailable = review.github === GITHUB_REVIEW_STATUS.AVAILABLE;
	const canPushToReview = review.canPushToReview;
	const canWriteToGitHub = review.canWriteToGitHub;

	const [isOpen, setIsOpen] = useState(!thread.isResolved);
	const [isReplying, setIsReplying] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<ReviewComment | null>(null);
	const [error, setError] = useState<string | null>(null);

	const activeEditingId = activeEditingCommentId(thread.comments, editingId, canPushToReview);
	const canReply = !isGitHub || canReplyToGitHubThread(thread, canWriteToGitHub, canPushToReview);
	const activeIsReplying = activeReplyingState(isReplying, canReply);
	useEffect(() => {
		if (editingId !== null && activeEditingId === null) {
			setEditingId(null);
			setError(null);
		}
	}, [editingId, activeEditingId]);
	useEffect(() => {
		if (isReplying && !activeIsReplying) {
			setIsReplying(false);
			setError(null);
		}
	}, [isReplying, activeIsReplying]);

	const root = thread.comments[0];
	if (!root) return null;
	const replies = thread.comments.slice(1);
	const idle = !activeIsReplying && activeEditingId === null;
	const publishesImmediately = isGitHub && canPublishReplyImmediately(thread);

	async function handleResolveToggle() {
		const next = !thread.isResolved;
		const wasOpen = isOpen;
		const hasActiveForm = activeIsReplying || activeEditingId !== null || deleteTarget !== null;
		if (!next || !hasActiveForm) setIsOpen(!next);
		try {
			if (thread.source === THREAD_SOURCE.GITHUB) {
				await review.resolveGitHub({ threadNodeId: thread.threadNodeId, resolved: next });
			} else {
				await review.resolveLocalThread({ threadId: thread.id, resolved: next });
			}
		} catch (err) {
			setIsOpen(wasOpen);
			toastError(err, "Failed to update resolved state");
		}
	}

	function handleOpenChange(open: boolean) {
		if (!open && (activeIsReplying || activeEditingId !== null || deleteTarget !== null)) return;
		setIsOpen(open);
	}

	async function submitReply(body: string, startReview: boolean, creationId: string) {
		setError(null);
		try {
			if (thread.source === THREAD_SOURCE.GITHUB) {
				// Published threads may choose pending vs immediate; draft-only threads
				// always pass true because CommentForm has no destination toggle.
				await review.replyGitHub({
					creationId,
					threadNodeId: thread.threadNodeId,
					body,
					pending: startReview,
				});
			} else {
				await review.replyLocal({ threadId: thread.id, body });
			}
			setIsReplying(false);
		} catch (err) {
			setError(errorMessage(err, "Failed to add reply"));
			throw err;
		}
	}

	async function submitEdit(comment: ReviewComment, body: string) {
		setError(null);
		try {
			if (comment.state === COMMENT_STATE.LOCAL) {
				await review.editLocalComment({ commentId: comment.id, body });
			} else {
				await review.editGitHubComment({ nodeId: comment.nodeId, body });
			}
			setEditingId(null);
		} catch (err) {
			setError(errorMessage(err, "Failed to update comment"));
			throw err;
		}
	}

	async function confirmDelete() {
		const comment = deleteTarget;
		setDeleteTarget(null);
		if (!comment) return;
		try {
			if (comment.state === COMMENT_STATE.LOCAL) {
				// Deleting a local root removes the whole thread; a reply removes just itself.
				if (comment.id === root?.id) await review.deleteLocalThread(thread.id);
				else await review.deleteLocalComment(comment.id);
			} else {
				await review.deleteGitHubComment(comment.nodeId);
			}
		} catch (err) {
			toastError(err, "Failed to delete comment");
		}
	}

	async function handleAddToReview() {
		try {
			await review.addToReview(thread.id);
		} catch (err) {
			toastError(err, "Failed to add to review");
		}
	}

	const rootDeleteRemovesReplies = deleteRemovesReplies(thread, root);

	return (
		<Collapsible open={isOpen} onOpenChange={handleOpenChange}>
			<div
				className={cn(
					"rounded-xl border bg-card",
					thread.isResolved ? "border-border/60" : "border-border",
				)}
			>
				<div className="flex items-center gap-2 p-1.5">
					<Tooltip>
						<TooltipTrigger asChild>
							<CollapsibleTrigger
								aria-label={isOpen ? "Collapse thread" : "Expand thread"}
								className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
							>
								<ChevronRight className={threadChevronClassName(isOpen)} />
							</CollapsibleTrigger>
						</TooltipTrigger>
						<TooltipContent>{isOpen ? "Collapse thread" : "Expand thread"}</TooltipContent>
					</Tooltip>
					<ResolveButton
						isResolved={thread.isResolved}
						onToggle={handleResolveToggle}
						disabled={!canToggleThreadResolution(thread, canWriteToGitHub)}
					/>
					<Byline comment={root} />
					<StateBadge state={root.state} />
					{idle && (
						<div className="flex shrink-0 items-center gap-0.5">
							{canAddLocalThreadToReview(
								thread,
								githubAvailable,
								canPushToReview,
								githubAnchorEligible,
							) && (
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											variant="ghost"
											size="icon-xs"
											aria-label="Add to review"
											className="rounded-md text-muted-foreground"
											onClick={handleAddToReview}
										>
											<GitPullRequestArrow className="size-3.5" />
										</Button>
									</TooltipTrigger>
									<TooltipContent>
										{thread.source === THREAD_SOURCE.LOCAL && thread.hasPromotionRecovery
											? "Resume adding to GitHub review"
											: "Add to GitHub review (pending)"}
									</TooltipContent>
								</Tooltip>
							)}
							{(!isGitHub || githubAvailable) && canReply && (
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											variant="ghost"
											size="icon-xs"
											aria-label="Reply"
											className="rounded-md text-muted-foreground"
											onClick={() => {
												setIsOpen(true);
												setError(null);
												setIsReplying(true);
											}}
										>
											<MessageSquare className="size-3.5" />
										</Button>
									</TooltipTrigger>
									<TooltipContent>Reply</TooltipContent>
								</Tooltip>
							)}
							{canEditReviewComment(root, canPushToReview) && (
								<CommentActions
									onEdit={() => {
										setIsOpen(true);
										setError(null);
										setEditingId(root.id);
									}}
									onDelete={() => setDeleteTarget(root)}
									deleteLabel={rootDeleteRemovesReplies ? "Delete thread" : "Delete"}
								/>
							)}
						</div>
					)}
				</div>

				<CollapsibleContent className="space-y-3 px-3 pb-3">
					{activeEditingId === root.id ? (
						<CommentForm
							label="Update"
							initialBody={root.body}
							placeholder="Edit your comment…"
							error={error}
							onSubmit={(b) => submitEdit(root, b)}
							onCancel={() => {
								setEditingId(null);
								setError(null);
							}}
						/>
					) : (
						<CommentBody comment={root} />
					)}

					{replies.length > 0 && (
						<div className="space-y-3 border-border/50 border-l-2 pl-4">
							{replies.map((reply) => (
								<ReplyItem
									key={reply.id}
									reply={reply}
									idle={idle}
									isEditing={activeEditingId === reply.id}
									error={activeEditingId === reply.id ? error : null}
									onEdit={() => {
										setError(null);
										setEditingId(reply.id);
									}}
									onCancelEdit={() => {
										setEditingId(null);
										setError(null);
									}}
									onSubmitEdit={(b) => submitEdit(reply, b)}
									onDelete={() => setDeleteTarget(reply)}
									canPushToReview={canPushToReview}
								/>
							))}
						</div>
					)}

					{activeIsReplying && (
						<ReplyCommentForm
							isGitHub={isGitHub}
							publishesImmediately={publishesImmediately}
							hasPendingReview={review.hasPendingReview}
							canPushToReview={canPushToReview}
							error={error}
							onSubmit={submitReply}
							onCancel={() => {
								setIsReplying(false);
								setError(null);
							}}
						/>
					)}
				</CollapsibleContent>
			</div>

			<DeleteDialog
				target={deleteTarget}
				isThread={deleteTarget !== null && deleteRemovesReplies(thread, deleteTarget)}
				onCancel={() => setDeleteTarget(null)}
				onConfirm={confirmDelete}
			/>
		</Collapsible>
	);
}

function ReplyCommentForm({
	isGitHub,
	publishesImmediately,
	hasPendingReview,
	canPushToReview,
	error,
	onSubmit,
	onCancel,
}: {
	isGitHub: boolean;
	publishesImmediately: boolean;
	hasPendingReview: boolean;
	canPushToReview: boolean;
	error: string | null;
	onSubmit: (body: string, pending: boolean, creationId: string) => Promise<void>;
	onCancel: () => void;
}) {
	const { setStartReview, startReview } = useCommentPreferences();
	const [creationId] = useState(() => crypto.randomUUID());
	const hasUsablePendingReview = hasPendingReview && canPushToReview;
	const showStartReview = isGitHub && publishesImmediately && !hasPendingReview && canPushToReview;
	const pending =
		isGitHub &&
		(!publishesImmediately || hasUsablePendingReview || (showStartReview && startReview));
	return (
		<CommentForm
			label="Reply"
			placeholder="Write a reply…"
			error={error}
			controls={
				!isGitHub
					? { local: { checked: true, disabled: true } }
					: showStartReview
						? {
								startReview: {
									checked: startReview,
									onCheckedChange: setStartReview,
								},
							}
						: undefined
			}
			onSubmit={(body) => onSubmit(body, pending, creationId)}
			onCancel={onCancel}
		/>
	);
}

function ResolveButton({
	isResolved,
	onToggle,
	disabled,
}: {
	isResolved: boolean;
	onToggle: () => void;
	disabled: boolean;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					onClick={onToggle}
					disabled={disabled}
					aria-label={isResolved ? "Reopen conversation" : "Mark as resolved"}
					className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
				>
					{isResolved ? (
						<CircleCheck className="size-3.5 text-green-600 dark:text-green-500" />
					) : (
						<Circle className="size-3.5" />
					)}
				</button>
			</TooltipTrigger>
			<TooltipContent>{isResolved ? "Reopen conversation" : "Mark as resolved"}</TooltipContent>
		</Tooltip>
	);
}

// Local comments (author null) render as the local reviewer; GitHub comments show
// their author.
function Byline({ comment }: { comment: ReviewComment }) {
	const viewer = useViewer();
	const name = comment.author?.login ?? viewer.name;
	const avatarUrl = comment.author ? comment.author.avatarUrl : viewer.avatarUrl;
	return (
		<p className="flex min-w-0 flex-1 items-center gap-1.5 text-muted-foreground text-sm">
			<Avatar className="size-5 shrink-0">
				{avatarUrl && <AvatarImage src={avatarUrl} alt={name} />}
				<AvatarFallback className="text-[10px]">
					<User className="size-3" />
				</AvatarFallback>
			</Avatar>
			<span className="font-medium text-foreground">{name}</span>
			{comment.htmlUrl ? (
				<a
					href={comment.htmlUrl}
					target="_blank"
					rel="noopener noreferrer"
					className="hover:underline"
					aria-label="View comment on GitHub"
				>
					<time dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString()}>
						{formatTimeAgo(comment.createdAt)}
					</time>
				</a>
			) : (
				<time dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString()}>
					{formatTimeAgo(comment.createdAt)}
				</time>
			)}
		</p>
	);
}

// GitHub comments render GitHub's own server-rendered HTML (resolves @mentions,
// #refs, emoji); local comments render their raw markdown.
function CommentBody({ comment }: { comment: ReviewComment }) {
	return comment.bodyHtml !== null ? (
		<Markdown content={comment.bodyHtml} allowHtml />
	) : (
		<Markdown content={comment.body} />
	);
}

function ReplyItem({
	reply,
	idle,
	isEditing,
	error,
	onEdit,
	onCancelEdit,
	onSubmitEdit,
	onDelete,
	canPushToReview,
}: {
	reply: ReviewComment;
	idle: boolean;
	isEditing: boolean;
	error: string | null;
	onEdit: () => void;
	onCancelEdit: () => void;
	onSubmitEdit: (body: string) => Promise<void>;
	onDelete: () => void;
	canPushToReview: boolean;
}) {
	return (
		<div className="space-y-1.5">
			<div className="flex items-center gap-2">
				<Byline comment={reply} />
				<StateBadge state={reply.state} />
				{idle && canEditReviewComment(reply, canPushToReview) && (
					<CommentActions onEdit={onEdit} onDelete={onDelete} />
				)}
			</div>
			{isEditing && canEditReviewComment(reply, canPushToReview) ? (
				<CommentForm
					label="Update"
					initialBody={reply.body}
					placeholder="Edit your comment…"
					error={error}
					onSubmit={onSubmitEdit}
					onCancel={onCancelEdit}
				/>
			) : (
				<CommentBody comment={reply} />
			)}
		</div>
	);
}

function DeleteDialog({
	target,
	isThread,
	onCancel,
	onConfirm,
}: {
	target: ReviewComment | null;
	isThread: boolean;
	onCancel: () => void;
	onConfirm: () => void;
}) {
	return (
		<AlertDialog
			open={target !== null}
			onOpenChange={(open) => {
				if (!open) onCancel();
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{isThread ? "Delete thread" : "Delete comment"}</AlertDialogTitle>
					<AlertDialogDescription>
						{isThread
							? "This deletes the whole conversation, including replies. This can't be undone."
							: "This deletes the comment. This can't be undone."}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<Button variant="destructive" onClick={onConfirm}>
						Delete
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function toastError(err: unknown, fallback: string): void {
	toast.error(errorMessage(err, fallback));
}
