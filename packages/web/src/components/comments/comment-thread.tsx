import type { GitHubComment } from "@stagereview/types/github-threads";
import { ChevronRight, Circle, CircleCheck, Github, MessageSquare, User } from "lucide-react";
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
import { useCommentThreadsContext } from "@/lib/comment-threads-context";
import { formatTimeAgo } from "@/lib/format";
import type { AnchoredGitHubThread, DisplayThread } from "@/lib/merge-threads";
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

/** Renders whichever thread kind the diff row holds — local note or GitHub thread. */
export function DisplayThreadView({ entry }: { entry: DisplayThread }) {
	return entry.kind === "local" ? (
		<CommentThreadView thread={entry.thread} />
	) : (
		<GitHubThreadView thread={entry.thread} />
	);
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

	function handleResolveToggle() {
		const next = !isResolved;
		// Collapse on resolve / expand on reopen — but never collapse out from under an
		// active reply/edit/delete form (it would unmount CommentForm and drop unsaved
		// text), mirroring the handleOpenChange guard.
		const hasActiveForm = isReplying || editingId !== null || deleteTarget !== null;
		if (!next || !hasActiveForm) setIsOpen(!next);
		void setThreadResolved({ threadId: thread.id, resolved: next });
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
					<ViewerByline createdAt={root.createdAt} />
					{thread.pending && <PendingBadge />}
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
							<CommentActions
								onEdit={() => {
									setIsOpen(true);
									setError(null);
									setEditingId(root.id);
								}}
								onDelete={() => setDeleteTarget({ kind: "thread", hasReplies: replies.length > 0 })}
								deleteLabel={replies.length > 0 ? "Delete thread" : "Delete"}
							/>
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

/** Who wrote a comment, however it reached us — the local viewer or a GitHub account. */
interface CommentAuthor {
	name: string;
	avatarUrl: string | null;
}

function ViewerByline({ createdAt }: { createdAt: string }) {
	const viewer = useViewer();
	return <CommentByline author={viewer} createdAt={createdAt} />;
}

function CommentByline({
	author,
	createdAt,
	url,
}: {
	author: CommentAuthor;
	createdAt: string;
	/** Links the timestamp out to the comment on GitHub. */
	url?: string;
}) {
	const initial = author.name.trim()[0]?.toUpperCase();
	const timestamp = (
		<time dateTime={createdAt} title={new Date(createdAt).toLocaleString()}>
			{formatTimeAgo(createdAt)}
		</time>
	);
	return (
		<p className="flex min-w-0 flex-1 items-center gap-1.5 text-muted-foreground text-sm">
			<Avatar className="size-5 shrink-0">
				{author.avatarUrl && <AvatarImage src={author.avatarUrl} alt={author.name} />}
				<AvatarFallback className="text-[10px]">
					{initial ?? <User className="size-3" />}
				</AvatarFallback>
			</Avatar>
			<span className="truncate font-medium text-foreground">{author.name}</span>
			{url ? (
				<a
					href={url}
					target="_blank"
					rel="noopener noreferrer"
					className="shrink-0 rounded-sm transition-colors hover:text-foreground hover:underline"
				>
					{timestamp}
				</a>
			) : (
				timestamp
			)}
		</p>
	);
}

/** Marks a local thread that will be posted to the PR when the review is submitted. */
function PendingBadge() {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Badge
					variant="outline"
					className="shrink-0 border-amber-600/30 px-2 py-0 text-[11px] text-amber-700 dark:border-amber-500/30 dark:text-amber-500"
				>
					Pending
				</Badge>
			</TooltipTrigger>
			<TooltipContent>Posts to the pull request when you finish your review</TooltipContent>
		</Tooltip>
	);
}

function githubAuthor(comment: GitHubComment): CommentAuthor {
	return { name: comment.author.name ?? comment.author.login, avatarUrl: comment.author.avatarUrl };
}

/**
 * A review thread that lives on GitHub. It supports replying and resolving —
 * editing and deleting stay on GitHub, so this variant has no action menu.
 */
function GitHubThreadView({ thread }: { thread: AnchoredGitHubThread }) {
	const { github } = useCommentThreadsContext();
	const [isOpen, setIsOpen] = useState(!thread.isResolved);
	const [isReplying, setIsReplying] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const root = thread.comments[0];
	// GitHub always returns a thread with at least its root comment; the empty
	// case only exists because noUncheckedIndexedAccess types the lookup that way.
	if (!root) return null;
	const replies = thread.comments.slice(1);

	async function toggleResolved() {
		const resolved = !thread.isResolved;
		if (!resolved || !isReplying) setIsOpen(!resolved);
		try {
			await github.setGitHubThreadResolved({
				threadNodeId: thread.githubThreadId,
				resolved,
			});
		} catch (err) {
			toast.error(errorMessage(err, "Failed to update the thread on GitHub"));
		}
	}

	// An arrow declared after the root guard, so its narrowing holds inside.
	const submitReply = async (body: string) => {
		setError(null);
		try {
			await github.replyToGitHubThread({ commentId: root.githubCommentId, body });
			setIsReplying(false);
		} catch (err) {
			setError(errorMessage(err, "Failed to post the reply to GitHub"));
			throw err;
		}
	};

	return (
		<Collapsible
			open={isOpen}
			onOpenChange={(open) => {
				if (!open && isReplying) return;
				setIsOpen(open);
			}}
		>
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
								<ChevronRight className="size-3.5 transition-transform duration-200 [[data-state=open]>&]:rotate-90" />
							</CollapsibleTrigger>
						</TooltipTrigger>
						<TooltipContent>{isOpen ? "Collapse thread" : "Expand thread"}</TooltipContent>
					</Tooltip>
					<ResolveButton isResolved={thread.isResolved} onToggle={() => void toggleResolved()} />
					<CommentByline author={githubAuthor(root)} createdAt={root.createdAt} url={root.url} />
					<Tooltip>
						<TooltipTrigger asChild>
							<Github className="size-3.5 shrink-0 text-muted-foreground" aria-label="On GitHub" />
						</TooltipTrigger>
						<TooltipContent>This conversation lives on GitHub</TooltipContent>
					</Tooltip>
					{!isReplying && (
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
				</div>

				<CollapsibleContent className="space-y-3 px-3 pb-3">
					<Markdown content={root.body} />

					{replies.length > 0 && (
						<div className="space-y-3 border-border/50 border-l-2 pl-4">
							{replies.map((reply) => (
								<div key={reply.githubCommentId} className="space-y-1.5">
									<CommentByline
										author={githubAuthor(reply)}
										createdAt={reply.createdAt}
										url={reply.url}
									/>
									<Markdown content={reply.body} />
								</div>
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
		</Collapsible>
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
				<ViewerByline createdAt={reply.createdAt} />
				{/* Only when the whole thread is idle, so opening this reply's editor can't
				    discard another in-progress edit or reply (matches the root comment). */}
				{idle && <CommentActions onEdit={onEdit} onDelete={onDelete} />}
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
