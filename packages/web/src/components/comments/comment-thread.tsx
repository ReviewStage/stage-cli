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
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { useCommentThreadsContext } from "@/lib/comment-threads-context";
import type { DisplayThread } from "@/lib/merge-threads";
import type { Comment, CommentThread } from "@/lib/use-comment-threads";
import { CommentActions } from "./comment-actions";
import { ViewerByline } from "./comment-byline";
import { CommentForm } from "./comment-form";
import { GitHubThreadView } from "./github-thread";
import { PendingBadge } from "./pending-badge";
import { ReplyButton, ThreadCard } from "./thread-card";

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

function CommentThreadView({ thread }: { thread: CommentThread }) {
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
	// Collapsing would unmount an open CommentForm and drop its unsaved text.
	const hasActiveForm = isReplying || editingId !== null || deleteTarget !== null;

	function handleResolveToggle() {
		const next = !isResolved;
		// Collapse on resolve / expand on reopen, unless a form is mid-edit.
		if (!next || !hasActiveForm) setIsOpen(!next);
		void setThreadResolved({ threadId: thread.id, resolved: next });
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
		<>
			<ThreadCard
				isOpen={isOpen}
				onOpenChange={(open) => {
					// Keep the thread expanded while the user is mid-action.
					if (!open && hasActiveForm) return;
					setIsOpen(open);
				}}
				isResolved={isResolved}
				onToggleResolved={handleResolveToggle}
				byline={<ViewerByline createdAt={root.createdAt} />}
				actions={
					<>
						{thread.pending && <PendingBadge>Pending</PendingBadge>}
						{idle && (
							<div className="flex shrink-0 items-center gap-0.5">
								<ReplyButton
									onClick={() => {
										setIsOpen(true);
										setError(null);
										setIsReplying(true);
									}}
								/>
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
							</div>
						)}
					</>
				}
			>
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
			</ThreadCard>

			<DeleteDialog
				target={deleteTarget}
				onCancel={() => setDeleteTarget(null)}
				onConfirm={confirmDelete}
			/>
		</>
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
