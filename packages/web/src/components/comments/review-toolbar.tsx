import { REVIEW_EVENT, type ReviewEvent } from "@stagereview/types/github-threads";
import { Send } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { CommentMarkdownEditor } from "@/components/comments/comment-markdown-editor";
import { PendingBadge } from "@/components/comments/pending-badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { useCommentThreadsContext } from "@/lib/comment-threads-context";

const REVIEW_EVENT_COPY: Record<ReviewEvent, { label: string; description: string }> = {
	[REVIEW_EVENT.COMMENT]: {
		label: "Comment",
		description: "Submit feedback without approving or requesting changes.",
	},
	[REVIEW_EVENT.APPROVE]: {
		label: "Approve",
		description: "Submit feedback and approve merging these changes.",
	},
	[REVIEW_EVENT.REQUEST_CHANGES]: {
		label: "Request changes",
		description: "Submit feedback that must be addressed before merging.",
	},
};

function Divider() {
	return <span className="mx-0.5 h-3 w-px shrink-0 bg-border" />;
}

/**
 * Pending-comment count plus the "Finish your review" composer. Rendered in the
 * PR header, so it only ever mounts for a run that has a pull request.
 */
export function ReviewToolbar() {
	const { threads, github } = useCommentThreadsContext();
	// The server posts each pending, unresolved thread as a single review comment
	// (replies are folded into that comment's body), so threads and comments count
	// 1:1 here. Resolved threads are excluded to match the submit route, which
	// never publishes a thread the user already marked resolved.
	const pendingCount = useMemo(
		() =>
			threads.reduce(
				(count, thread) => (thread.pending && !thread.resolvedAt ? count + 1 : count),
				0,
			),
		[threads],
	);

	const radioGroupName = useId();
	const [isOpen, setIsOpen] = useState(false);
	const [body, setBody] = useState("");
	const [event, setEvent] = useState<ReviewEvent>(REVIEW_EVENT.COMMENT);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	// The fetch shells out to `gh` and takes seconds, so hold the toolbar's space
	// rather than popping the button in after the diff has already painted.
	if (github.isLoading) {
		return (
			<div className="flex items-center gap-2">
				<Divider />
				<Skeleton className="h-7 w-36 rounded-md" />
			</div>
		);
	}

	// Nothing to show when there's no way to submit and nothing waiting to be sent.
	if (!github.available && pendingCount === 0) return null;

	// GitHub rejects a review carrying neither a body nor comments; approving
	// needs neither.
	const canSubmit = event === REVIEW_EVENT.APPROVE || body.trim().length > 0 || pendingCount > 0;

	async function submit() {
		setIsSubmitting(true);
		try {
			await github.submitReview({ event, body: body.trim() });
			setBody("");
			setEvent(REVIEW_EVENT.COMMENT);
			setIsOpen(false);
			toast.success("Review submitted");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to submit review");
		} finally {
			setIsSubmitting(false);
		}
	}

	return (
		<div className="flex min-w-0 items-center gap-2">
			<Divider />
			{pendingCount > 0 && <PendingBadge>{pendingCount} pending</PendingBadge>}
			{github.available ? (
				<Popover
					open={isOpen}
					onOpenChange={(open) => {
						if (!isSubmitting) setIsOpen(open);
					}}
				>
					<PopoverTrigger asChild>
						<Button variant="outline" size="sm" className="h-7 cursor-pointer px-2">
							<Send className="size-3.5" aria-hidden="true" />
							<span className="ml-1 text-xs">Finish your review</span>
						</Button>
					</PopoverTrigger>
					<PopoverContent align="end" collisionPadding={12} className="w-96 space-y-3 p-3">
						<CommentMarkdownEditor
							value={body}
							onChange={setBody}
							textareaRef={textareaRef}
							placeholder="Summarize your review…"
							disabled={isSubmitting}
							minRows={3}
							maxRows={10}
							className="rounded-xl border border-border bg-card transition-shadow has-[textarea:focus-visible]:border-ring has-[textarea:focus-visible]:ring-2 has-[textarea:focus-visible]:ring-ring/20"
							textareaClassName="max-h-[12rem] overflow-y-auto"
							previewClassName="max-h-[12rem] overflow-y-auto"
						/>
						<fieldset className="space-y-0.5" disabled={isSubmitting}>
							<legend className="sr-only">Review action</legend>
							{Object.values(REVIEW_EVENT).map((value) => (
								<label
									key={value}
									className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent has-[:checked]:bg-accent"
								>
									<input
										type="radio"
										name={radioGroupName}
										value={value}
										checked={event === value}
										onChange={() => setEvent(value)}
										className="mt-0.5 size-3.5 shrink-0 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									/>
									<span className="min-w-0">
										<span className="block font-medium text-xs">
											{REVIEW_EVENT_COPY[value].label}
										</span>
										<span className="block text-muted-foreground text-xs">
											{REVIEW_EVENT_COPY[value].description}
										</span>
									</span>
								</label>
							))}
						</fieldset>
						<div className="flex items-center justify-between gap-2">
							<p className="text-muted-foreground text-xs">
								{pendingCount === 1 ? "1 pending comment" : `${pendingCount} pending comments`}
							</p>
							<Button size="sm" onClick={() => void submit()} disabled={isSubmitting || !canSubmit}>
								{isSubmitting ? "Submitting…" : "Submit review"}
							</Button>
						</div>
					</PopoverContent>
				</Popover>
			) : (
				<p className="min-w-0 truncate text-muted-foreground text-xs">
					GitHub unavailable — install/authenticate <code className="font-mono">gh</code> to submit
				</p>
			)}
		</div>
	);
}
