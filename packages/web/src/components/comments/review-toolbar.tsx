import { REVIEW_EVENT, type ReviewEvent } from "@stagereview/types/github-threads";
import { Send } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { CommentMarkdownEditor } from "@/components/comments/comment-markdown-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/sonner";
import { useCommentThreadsContext } from "@/lib/comment-threads-context";

const REVIEW_EVENT_OPTIONS: { value: ReviewEvent; label: string; description: string }[] = [
	{
		value: REVIEW_EVENT.COMMENT,
		label: "Comment",
		description: "Submit feedback without approving or requesting changes.",
	},
	{
		value: REVIEW_EVENT.APPROVE,
		label: "Approve",
		description: "Submit feedback and approve merging these changes.",
	},
	{
		value: REVIEW_EVENT.REQUEST_CHANGES,
		label: "Request changes",
		description: "Submit feedback that must be addressed before merging.",
	},
];

/**
 * Pending-comment count plus the "Finish your review" composer. Rendered in the
 * PR header, so it only ever mounts for a run that has a pull request.
 */
export function ReviewToolbar() {
	const { threads, github } = useCommentThreadsContext();
	const pendingCount = useMemo(
		() => threads.reduce((count, thread) => (thread.pending ? count + 1 : count), 0),
		[threads],
	);

	const [isOpen, setIsOpen] = useState(false);
	const [body, setBody] = useState("");
	const [event, setEvent] = useState<ReviewEvent>(REVIEW_EVENT.COMMENT);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	// Nothing to show when there's no way to submit and nothing waiting to be sent.
	if (!github.available && pendingCount === 0) return null;

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
			<span className="mx-0.5 h-3 w-px shrink-0 bg-border" />
			{pendingCount > 0 && (
				<Badge
					variant="outline"
					className="border-amber-600/30 text-amber-700 dark:border-amber-500/30 dark:text-amber-500"
				>
					{pendingCount} pending
				</Badge>
			)}
			{github.available ? (
				<Popover
					open={isOpen}
					onOpenChange={(open) => {
						if (!isSubmitting) setIsOpen(open);
					}}
				>
					<PopoverTrigger asChild>
						<Button variant="outline" size="sm" className="h-7 px-2">
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
							{REVIEW_EVENT_OPTIONS.map((option) => (
								<label
									key={option.value}
									className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent has-[:checked]:bg-accent"
								>
									<input
										type="radio"
										name="review-event"
										value={option.value}
										checked={event === option.value}
										onChange={() => setEvent(option.value)}
										className="mt-0.5 size-3.5 shrink-0 accent-primary"
									/>
									<span className="min-w-0">
										<span className="block font-medium text-xs">{option.label}</span>
										<span className="block text-muted-foreground text-xs">
											{option.description}
										</span>
									</span>
								</label>
							))}
						</fieldset>
						<div className="flex items-center justify-between gap-2">
							<p className="text-muted-foreground text-xs">
								{pendingCount === 1 ? "1 pending comment" : `${pendingCount} pending comments`}
							</p>
							<Button size="sm" onClick={() => void submit()} disabled={isSubmitting}>
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
