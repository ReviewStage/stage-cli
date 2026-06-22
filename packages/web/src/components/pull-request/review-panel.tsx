import { REVIEW_EVENT, type ReviewEvent } from "@stagereview/types/review";
import { MessageSquarePlus, Trash2 } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useReviewContext } from "@/lib/review-context";
import { GITHUB_REVIEW_STATUS } from "@/lib/use-review";
import { cn } from "@/lib/utils";

const ACTION_OPTIONS: { event: ReviewEvent; label: string; description: string }[] = [
	{
		event: REVIEW_EVENT.COMMENT,
		label: "Comment",
		description: "Submit general feedback without approval",
	},
	{ event: REVIEW_EVENT.APPROVE, label: "Approve", description: "Approve this pull request" },
	{
		event: REVIEW_EVENT.REQUEST_CHANGES,
		label: "Request changes",
		description: "Submit feedback that must be addressed",
	},
];

function ActionSelector({
	selected,
	onSelect,
	disabled,
}: {
	selected: ReviewEvent;
	onSelect: (event: ReviewEvent) => void;
	disabled: boolean;
}) {
	return (
		<div className="mt-3 flex flex-col gap-1.5">
			{ACTION_OPTIONS.map(({ event, label, description }) => {
				const isSelected = selected === event;
				return (
					<button
						key={event}
						type="button"
						aria-pressed={isSelected}
						disabled={disabled}
						onClick={() => onSelect(event)}
						className={cn(
							"flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
							isSelected ? "border-border bg-primary/5" : "border-border hover:bg-accent/50",
							disabled && "cursor-not-allowed opacity-50",
						)}
					>
						<span
							className={cn(
								"flex size-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
								isSelected ? "border-primary" : "border-muted-foreground/40",
							)}
						>
							{isSelected && <span className="size-2 rounded-full bg-primary" />}
						</span>
						<div className="min-w-0">
							<div className={cn("font-medium", isSelected && "text-primary")}>{label}</div>
							<div className="text-muted-foreground text-xs">{description}</div>
						</div>
					</button>
				);
			})}
		</div>
	);
}

/**
 * The review tray: submit the viewer's pending GitHub review (Comment / Approve /
 * Request changes) or discard it. Only shown when the run targets a reachable PR;
 * the pending badge counts the viewer's draft comments.
 */
export function ReviewPanel() {
	const review = useReviewContext();
	const [open, setOpen] = useState(false);
	const [body, setBody] = useState("");
	const [selected, setSelected] = useState<ReviewEvent>(REVIEW_EVENT.COMMENT);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [showDiscard, setShowDiscard] = useState(false);

	if (review.github !== GITHUB_REVIEW_STATUS.AVAILABLE) return null;

	const { pendingCommentCount, hasPendingReview } = review;
	const hasContent = body.trim().length > 0;
	// A bare "Comment" submit with neither body nor pending comments is a no-op.
	const canSubmit =
		!isSubmitting && (selected !== REVIEW_EVENT.COMMENT || hasContent || pendingCommentCount > 0);

	async function handleSubmit() {
		setIsSubmitting(true);
		try {
			await review.submitReview({ event: selected, body: body.trim() });
			setBody("");
			setOpen(false);
			toast.success("Review submitted");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to submit review");
		} finally {
			setIsSubmitting(false);
		}
	}

	async function handleDiscard() {
		setIsSubmitting(true);
		try {
			await review.discardReview();
			setShowDiscard(false);
			setOpen(false);
			toast.success("Pending review discarded");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to discard review");
		} finally {
			setIsSubmitting(false);
		}
	}

	return (
		<>
			<Popover open={open} onOpenChange={setOpen}>
				<Tooltip>
					<TooltipTrigger asChild>
						<PopoverTrigger asChild>
							<Button size="sm" className="h-7 cursor-pointer px-2">
								<MessageSquarePlus className="size-3.5" />
								<span className="ml-1 hidden text-xs @7xl:inline">Review</span>
								{pendingCommentCount > 0 && (
									<Badge className="ml-1 h-4 min-w-4 border-0 bg-primary-foreground/20 px-1 text-[10px] leading-none text-primary-foreground">
										{pendingCommentCount}
									</Badge>
								)}
							</Button>
						</PopoverTrigger>
					</TooltipTrigger>
					<TooltipContent>Submit your review</TooltipContent>
				</Tooltip>
				<PopoverContent align="end" className="w-96">
					<p className="font-medium text-sm">Finish your review</p>
					<p className="mt-0.5 text-muted-foreground text-xs">
						{pendingCommentCount > 0
							? `${pendingCommentCount} pending comment${pendingCommentCount === 1 ? "" : "s"} will be published.`
							: "No pending comments yet — add comments to your review from the diff."}
					</p>
					<textarea
						value={body}
						onChange={(e) => setBody(e.target.value)}
						disabled={isSubmitting}
						placeholder="Leave a summary comment (optional)…"
						className="mt-3 min-h-[5rem] w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
					/>
					<ActionSelector selected={selected} onSelect={setSelected} disabled={isSubmitting} />
					<div className="mt-3 flex items-center justify-between">
						<Button
							variant="ghost"
							size="sm"
							onClick={() => (hasPendingReview ? setShowDiscard(true) : setOpen(false))}
							disabled={isSubmitting}
							className={hasPendingReview ? "text-destructive hover:text-destructive" : ""}
						>
							{hasPendingReview ? (
								<>
									<Trash2 className="mr-1.5 size-3.5" />
									Discard
								</>
							) : (
								"Cancel"
							)}
						</Button>
						<Button size="sm" onClick={handleSubmit} disabled={!canSubmit}>
							{isSubmitting ? "Submitting…" : "Submit"}
						</Button>
					</div>
				</PopoverContent>
			</Popover>

			<AlertDialog
				open={showDiscard}
				onOpenChange={(v) => {
					if (!v && !isSubmitting) setShowDiscard(false);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Discard review</AlertDialogTitle>
						<AlertDialogDescription>
							This deletes all your pending comments on the PR. This can't be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
						<Button variant="destructive" onClick={handleDiscard} disabled={isSubmitting}>
							{isSubmitting ? "Discarding…" : "Discard"}
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
