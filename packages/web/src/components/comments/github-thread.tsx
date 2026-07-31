import { Github } from "lucide-react";
import { useState } from "react";
import { Markdown } from "@/components/ui/markdown";
import { toast } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCommentThreadsContext } from "@/lib/comment-threads-context";
import type { AnchoredGitHubThread } from "@/lib/merge-threads";
import { CommentByline, gitHubByline } from "./comment-byline";
import { CommentForm } from "./comment-form";
import { ReplyButton, ThreadCard } from "./thread-card";

function errorMessage(err: unknown, fallback: string): string {
	return err instanceof Error ? err.message : fallback;
}

/**
 * A review thread that lives on GitHub. It supports replying and resolving —
 * editing and deleting stay on GitHub, so this variant has no action menu.
 */
export function GitHubThreadView({ thread }: { thread: AnchoredGitHubThread }) {
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
		// Collapse on resolve / expand on reopen, but never out from under the
		// reply composer — that would unmount it and drop unsaved text.
		const wasOpen = isOpen;
		if (!resolved || !isReplying) setIsOpen(!resolved);
		try {
			await github.setGitHubThreadResolved({ threadNodeId: thread.githubThreadId, resolved });
		} catch (err) {
			// The thread stays as it was on GitHub, so put the card back too.
			setIsOpen(wasOpen);
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
		<ThreadCard
			isOpen={isOpen}
			onOpenChange={(open) => {
				// Keep the thread expanded while the user is mid-reply.
				if (!open && isReplying) return;
				setIsOpen(open);
			}}
			isResolved={thread.isResolved}
			onToggleResolved={() => void toggleResolved()}
			byline={<CommentByline comment={gitHubByline(root)} />}
			actions={
				<>
					<Tooltip>
						<TooltipTrigger asChild>
							<Github className="size-3.5 shrink-0 text-muted-foreground" aria-label="On GitHub" />
						</TooltipTrigger>
						<TooltipContent>This conversation lives on GitHub</TooltipContent>
					</Tooltip>
					{!isReplying && (
						<ReplyButton
							onClick={() => {
								setIsOpen(true);
								setError(null);
								setIsReplying(true);
							}}
						/>
					)}
				</>
			}
		>
			<Markdown content={root.body} />

			{replies.length > 0 && (
				<div className="space-y-3 border-border/50 border-l-2 pl-4">
					{replies.map((reply) => (
						<div key={reply.githubCommentId} className="space-y-1.5">
							<CommentByline comment={gitHubByline(reply)} />
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
		</ThreadCard>
	);
}
