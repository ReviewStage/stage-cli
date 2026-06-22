import { ChevronRight, Circle, CircleCheck, MessageSquare, User } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Markdown } from "@/components/ui/markdown";
import { toast } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCommentThreadsContext } from "@/lib/comment-threads-context";
import { formatTimeAgo } from "@/lib/format";
import type { Comment, CommentThread } from "@/lib/use-comment-threads";
import { useViewer } from "@/lib/use-viewer";
import { cn } from "@/lib/utils";
import { CommentActions } from "./comment-actions";
import { CommentForm } from "./comment-form";

type DeleteTarget =
	| { kind: "thread"; hasReplies: boolean }
	| { kind: "comment"; commentId: string };

function errorMessage(err: unknown, fallback: string): string {
	return err instanceof Error ? err.message : fallback;
}

export function CommentThreadView({ thread }: { thread: CommentThread }) {
	const { replyToThread, setThreadResolved, editComment, deleteThread, deleteComment } =
		useCommentThreadsContext();
	const isResolved = thread.resolvedAt !== null;

	const [isOpen, setIsOpen] = useState(!isResolved);
	const [isReplying, setIsReplying] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
	const [error, setError] = useState<string | null>(null);

	const root = thread.comments[0];
	// A thread always has a root comment (deleting the last one removes the thread),
	// but noUncheckedIndexedAccess types the lookup as possibly-undefined.
	if (!root) return null;
	const replies = thread.comments.slice(1);

	async function handleResolveToggle() {
		const next = !isResolved;
		const wasOpen = isOpen;
		// Collapse on resolve / expand on reopen — but never collapse out from under an
		// active reply/edit/delete form (it would unmount CommentForm and drop unsaved
		// text), mirroring the handleOpenChange guard.
		const hasActiveForm = isReplying || editingId !== null || deleteTarget !== null;
		if (!next || !hasActiveForm) setIsOpen(!next);
		try {
			// For PR-originated threads this also resolves/reopens the thread on GitHub;
			// on failure the server leaves local state unchanged, so revert the collapse
			// and surface the reason.
			await setThreadResolved({ threadId: thread.id, resolved: next });
		} catch (err) {
			setIsOpen(wasOpen);
			toast.error(errorMessage(err, "Failed to update resolved state"));
		}
	}

	function handleOpenChange(open: boolean) {
		// Keep the thread expanded while the user is mid-action.
		if (!open && (isReplying || editingId !== null || deleteTarget !== null)) return;
		setIsOpen(open);
	}

	async function submitReply(body: string) {
		setError(null);
		try {
			await replyToThread({ threadId: thread.id, body });
			setIsReplying(false);
		} catch (err) {
			setError(errorMessage(err, "Failed to add reply"));
			throw err;
		}
	}

	async function submitEdit(commentId: string, body: string) {
		setError(null);
		try {
			await editComment({ commentId, body });
			setEditingId(null);
		} catch (err) {
			setError(errorMessage(err, "Failed to update comment"));
			throw err;
		}
	}

	function confirmDelete() {
		if (!deleteTarget) return;
		if (deleteTarget.kind === "thread") void deleteThread(thread.id);
		else void deleteComment(deleteTarget.commentId);
		setDeleteTarget(null);
	}

	const idle = !isReplying && editingId === null;

	return (
		<Collapsible open={isOpen} onOpenChange={handleOpenChange}>
			<div
				className={cn(
					"rounded-xl border bg-card",
					isResolved ? "border-border/60" : "border-border",
				)}
			>
				<div className="flex items-center gap-2 p-1.5">
					<Tooltip>
						<TooltipTrigger asChild>
							<CollapsibleTrigger
								aria-label={isOpen ? "Collapse thread" : "Expand thread"}
								className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
							>
								<ChevronRight className="size-3.5 transition-transform duration-200 [[data-state=open]>&]:rotate-90" />
							</CollapsibleTrigger>
						</TooltipTrigger>
						<TooltipContent>{isOpen ? "Collapse thread" : "Expand thread"}</TooltipContent>
					</Tooltip>
					<ResolveButton isResolved={isResolved} onToggle={handleResolveToggle} />
					<CommentByline comment={root} />
					{idle && (
						<div className="flex shrink-0 items-center gap-0.5">
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
							{/* Pulled GitHub comments are read-only locally; only local comments can be edited/deleted. */}
							{root.author === null && (
								<CommentActions
									onEdit={() => {
										setIsOpen(true);
										setError(null);
										setEditingId(root.id);
									}}
									onDelete={() =>
										setDeleteTarget({ kind: "thread", hasReplies: replies.length > 0 })
									}
									deleteLabel={replies.length > 0 ? "Delete thread" : "Delete"}
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
							onSubmit={(b) => submitEdit(root.id, b)}
							onCancel={() => {
								setEditingId(null);
								setError(null);
							}}
						/>
					) : (
						<Markdown content={root.body} />
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
										setError(null);
										setEditingId(reply.id);
									}}
									onCancelEdit={() => {
										setEditingId(null);
										setError(null);
									}}
									onSubmitEdit={(b) => submitEdit(reply.id, b)}
									onDelete={() => setDeleteTarget({ kind: "comment", commentId: reply.id })}
								/>
							))}
						</div>
					)}

					{isReplying && (
						<CommentForm
							label="Reply"
							placeholder="Write a reply…"
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

// A local comment (`author: null`) renders as the local reviewer; a comment pulled
// from the PR renders its GitHub author.
function CommentByline({ comment }: { comment: Comment }) {
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
			<time dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString()}>
				{formatTimeAgo(comment.createdAt)}
			</time>
		</p>
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
	reply: Comment;
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
				<CommentByline comment={reply} />
				{/* Only when the whole thread is idle, so opening this reply's editor can't
				    discard another in-progress edit or reply (matches the root comment).
				    Pulled GitHub replies are read-only locally. */}
				{idle && reply.author === null && <CommentActions onEdit={onEdit} onDelete={onDelete} />}
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
				<Markdown content={reply.body} />
			)}
		</div>
	);
}

function DeleteDialog({
	target,
	onCancel,
	onConfirm,
}: {
	target: DeleteTarget | null;
	onCancel: () => void;
	onConfirm: () => void;
}) {
	const isThreadDelete = target?.kind === "thread" && target.hasReplies;
	return (
		<AlertDialog
			open={target !== null}
			onOpenChange={(open) => {
				if (!open) onCancel();
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{isThreadDelete ? "Delete thread" : "Delete comment"}</AlertDialogTitle>
					<AlertDialogDescription>
						{isThreadDelete
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
