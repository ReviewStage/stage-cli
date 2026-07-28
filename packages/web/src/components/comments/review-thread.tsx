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
import { useState } from "react";
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

// A pending comment is editable (it's the viewer's own draft); a local comment is
// editable too. Submitted comments live on GitHub and are read-only here.
function canActOn(comment: ReviewComment): boolean {
	return comment.state !== COMMENT_STATE.SUBMITTED;
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

export function ReviewThreadView({ thread }: { thread: ReviewThread }) {
	const review = useReviewContext();
	const isGitHub = thread.source === THREAD_SOURCE.GITHUB;
	const githubAvailable = review.github === GITHUB_REVIEW_STATUS.AVAILABLE;
	const canPushToReview = review.canPushToReview;

	const [isOpen, setIsOpen] = useState(!thread.isResolved);
	const [isReplying, setIsReplying] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<ReviewComment | null>(null);
	const [error, setError] = useState<string | null>(null);

	const root = thread.comments[0];
	if (!root) return null;
	const replies = thread.comments.slice(1);
	const idle = !isReplying && editingId === null;

	function setOpenError(message: string | null) {
		setError(message);
	}

	async function handleResolveToggle() {
		const next = !thread.isResolved;
		const wasOpen = isOpen;
		const hasActiveForm = isReplying || editingId !== null || deleteTarget !== null;
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
		if (!open && (isReplying || editingId !== null || deleteTarget !== null)) return;
		setIsOpen(open);
	}

	async function submitReply(body: string, startReview: boolean) {
		setOpenError(null);
		try {
			if (thread.source === THREAD_SOURCE.GITHUB) {
				// Published threads may choose pending vs immediate; draft-only threads
				// always pass true because CommentForm has no destination toggle.
				await review.replyGitHub({ threadNodeId: thread.threadNodeId, body, pending: startReview });
			} else {
				await review.replyLocal({ threadId: thread.id, body });
			}
			setIsReplying(false);
		} catch (err) {
			setOpenError(errorMessage(err, "Failed to add reply"));
			throw err;
		}
	}

	async function submitEdit(comment: ReviewComment, body: string) {
		setOpenError(null);
		try {
			if (comment.state === COMMENT_STATE.LOCAL) {
				await review.editLocalComment({ commentId: comment.id, body });
			} else {
				await review.editGitHubComment({ nodeId: comment.nodeId, body });
			}
			setEditingId(null);
		} catch (err) {
			setOpenError(errorMessage(err, "Failed to update comment"));
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

	const rootIsDeletableThread = root.state === COMMENT_STATE.LOCAL && replies.length > 0;

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
					<ResolveButton isResolved={thread.isResolved} onToggle={handleResolveToggle} />
					<Byline comment={root} />
					<StateBadge state={root.state} />
					{idle && (
						<div className="flex shrink-0 items-center gap-0.5">
							{root.state === COMMENT_STATE.LOCAL && canPushToReview && (
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
									<TooltipContent>Add to GitHub review (pending)</TooltipContent>
								</Tooltip>
							)}
							{(!isGitHub || githubAvailable) && (
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											variant="ghost"
											size="icon-xs"
											aria-label="Reply"
											className="rounded-md text-muted-foreground"
											onClick={() => {
												setIsOpen(true);
												setOpenError(null);
												setIsReplying(true);
											}}
										>
											<MessageSquare className="size-3.5" />
										</Button>
									</TooltipTrigger>
									<TooltipContent>Reply</TooltipContent>
								</Tooltip>
							)}
							{canActOn(root) && (
								<CommentActions
									onEdit={() => {
										setIsOpen(true);
										setOpenError(null);
										setEditingId(root.id);
									}}
									onDelete={() => setDeleteTarget(root)}
									deleteLabel={rootIsDeletableThread ? "Delete thread" : "Delete"}
								/>
							)}
						</div>
					)}
				</div>

				<CollapsibleContent className="space-y-3 px-3 pb-3">
					{editingId === root.id ? (
						<CommentForm
							label="Update"
							initialBody={root.body}
							placeholder="Edit your comment…"
							error={error}
							onSubmit={(b) => submitEdit(root, b)}
							onCancel={() => {
								setEditingId(null);
								setOpenError(null);
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
									isEditing={editingId === reply.id}
									error={editingId === reply.id ? error : null}
									onEdit={() => {
										setOpenError(null);
										setEditingId(reply.id);
									}}
									onCancelEdit={() => {
										setEditingId(null);
										setOpenError(null);
									}}
									onSubmitEdit={(b) => submitEdit(reply, b)}
									onDelete={() => setDeleteTarget(reply)}
								/>
							))}
						</div>
					)}

					{isReplying && (
						<CommentForm
							label="Reply"
							placeholder="Write a reply…"
							error={error}
							destination={
								isGitHub
									? canPublishReplyImmediately(thread)
										? {
												toggleLabel: "Start a review",
												on: {
													label: "Pending on GitHub",
													description: "Only you can see it until you submit your review.",
													isGitHub: true,
												},
												off: {
													label: "Published on GitHub",
													description: "Everyone viewing the pull request can see it immediately.",
													isGitHub: true,
												},
											}
										: {
												label: "Pending on GitHub",
												description:
													"This thread is still a draft. Your reply will publish with the review.",
												isGitHub: true,
											}
									: {
											label: "Local only",
											description: "Saved on this machine and never sent to GitHub.",
											isGitHub: false,
										}
							}
							onSubmit={submitReply}
							onCancel={() => {
								setIsReplying(false);
								setOpenError(null);
							}}
						/>
					)}
				</CollapsibleContent>
			</div>

			<DeleteDialog
				target={deleteTarget}
				isThread={rootIsDeletableThread && deleteTarget?.id === root.id}
				onCancel={() => setDeleteTarget(null)}
				onConfirm={confirmDelete}
			/>
		</Collapsible>
	);
}

function ResolveButton({ isResolved, onToggle }: { isResolved: boolean; onToggle: () => void }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					onClick={onToggle}
					aria-label={isResolved ? "Reopen conversation" : "Mark as resolved"}
					className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
}: {
	reply: ReviewComment;
	idle: boolean;
	isEditing: boolean;
	error: string | null;
	onEdit: () => void;
	onCancelEdit: () => void;
	onSubmitEdit: (body: string) => Promise<void>;
	onDelete: () => void;
}) {
	return (
		<div className="space-y-1.5">
			<div className="flex items-center gap-2">
				<Byline comment={reply} />
				<StateBadge state={reply.state} />
				{idle && canActOn(reply) && <CommentActions onEdit={onEdit} onDelete={onDelete} />}
			</div>
			{isEditing ? (
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
