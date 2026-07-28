import {
	type PendingReviewComment,
	REVIEW_EVENT,
	type ReviewEvent,
} from "@stagereview/types/review";
import { ChevronRight, CornerDownLeft, MessageSquarePlus, Trash2 } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { CommentMarkdownEditor } from "@/components/comments/comment-markdown-editor";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useReviewContext } from "@/lib/review-context";
import { canSubmitReview } from "@/lib/review-submission";
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

// Flatten the viewer's pending comments, grouped by file, for the "what you're
// about to submit" list.
function collectPendingByFile(
	comments: PendingReviewComment[],
): Map<string, PendingReviewComment[]> {
	const byFile = new Map<string, PendingReviewComment[]>();
	for (const comment of comments) {
		const list = byFile.get(comment.filePath) ?? [];
		if (!byFile.has(comment.filePath)) byFile.set(comment.filePath, list);
		list.push(comment);
	}
	return byFile;
}

function ActionSelector({
	selected,
	onSelect,
	disabled,
	isOwnPullRequest,
}: {
	selected: ReviewEvent;
	onSelect: (event: ReviewEvent) => void;
	disabled: boolean;
	isOwnPullRequest: boolean;
}) {
	return (
		<div className="mt-3 flex flex-col gap-1.5">
			{ACTION_OPTIONS.map(({ event, label, description }) => {
				const isSelected = selected === event;
				// GitHub forbids approving / requesting changes on your own PR.
				const blockedByOwnership = isOwnPullRequest && event !== REVIEW_EVENT.COMMENT;
				const isDisabled = disabled || blockedByOwnership;
				return (
					<button
						key={event}
						type="button"
						aria-pressed={isSelected}
						disabled={isDisabled}
						onClick={() => onSelect(event)}
						className={cn(
							"flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
							isSelected ? "border-border bg-primary/5" : "border-border hover:bg-accent/50",
							isDisabled && "cursor-not-allowed opacity-50",
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
							<div className="text-muted-foreground text-xs">
								{blockedByOwnership ? "Not available on your own pull request" : description}
							</div>
						</div>
					</button>
				);
			})}
		</div>
	);
}

function PendingCommentsList({
	byFile,
	count,
}: {
	byFile: Map<string, PendingReviewComment[]>;
	count: number;
}) {
	const [open, setOpen] = useState(false);
	if (count === 0) return null;
	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<CollapsibleTrigger className="mt-3 flex items-center gap-1.5 font-medium text-muted-foreground text-xs hover:text-foreground">
				<ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
				Pending comments
				<Badge variant="secondary" className="h-4 min-w-4 px-1 text-[10px] leading-none">
					{count}
				</Badge>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<div className="mt-1.5 max-h-[200px] overflow-y-auto rounded-lg border border-border bg-muted/30">
					<div className="divide-y divide-border/50">
						{[...byFile.entries()].map(([path, comments]) => (
							<div key={path} className="px-3 py-2">
								<p className="min-w-0 truncate font-mono text-foreground text-xs">{path}</p>
								<div className="mt-1 space-y-1">
									{comments.map((c) => (
										<div key={c.id} className="flex items-baseline gap-2 pl-2 text-xs">
											<span className="inline-block w-10 shrink-0 text-right font-mono text-muted-foreground">
												{c.line === null ? "Outdated" : `L${c.line}`}
											</span>
											<span className="line-clamp-1 text-muted-foreground">{c.body}</span>
										</div>
									))}
								</div>
							</div>
						))}
					</div>
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * The review tray: submit the viewer's pending GitHub review (Comment / Approve /
 * Request changes) or discard it. Only shown when the run targets a reachable PR;
 * the badge counts the viewer's draft comments and the list shows what will publish.
 */
export function ReviewPanel() {
	const review = useReviewContext();
	const [open, setOpen] = useState(false);
	const [body, setBody] = useState("");
	const [selected, setSelected] = useState<ReviewEvent>(REVIEW_EVENT.COMMENT);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [showDiscard, setShowDiscard] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const { pendingCommentCount, hasPendingReview, isOwnPullRequest } = review;
	const pendingByFile = useMemo(
		() => collectPendingByFile(review.pendingComments),
		[review.pendingComments],
	);
	useEffect(() => setBody(review.pendingReviewBody), [review.pendingReviewBody]);

	if (review.github !== GITHUB_REVIEW_STATUS.AVAILABLE) return null;

	// On your own PR only "Comment" is allowed; coerce the effective event so a stale
	// Approve/Request-changes selection can never be submitted (the radios are disabled,
	// but the prior `selected` state would otherwise persist).
	const effectiveEvent =
		isOwnPullRequest && selected !== REVIEW_EVENT.COMMENT ? REVIEW_EVENT.COMMENT : selected;
	const canSubmit = canSubmitReview({
		event: effectiveEvent,
		body,
		pendingCommentCount,
		isSubmitting,
	});

	function selectAction(event: ReviewEvent) {
		if (isOwnPullRequest && event !== REVIEW_EVENT.COMMENT) return;
		setSelected(event);
	}

	async function handleSubmit() {
		if (!canSubmit) return;
		setIsSubmitting(true);
		try {
			await review.submitReview({ event: effectiveEvent, body: body.trim() });
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

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			void handleSubmit();
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
					<CommentMarkdownEditor
						value={body}
						onChange={setBody}
						textareaRef={textareaRef}
						disabled={isSubmitting}
						placeholder={
							effectiveEvent === REVIEW_EVENT.REQUEST_CHANGES
								? "Summarize the requested changes…"
								: "Leave a summary comment (optional)…"
						}
						onKeyDown={handleKeyDown}
						minRows={3}
						maxRows={10}
						className="mt-3 rounded-lg border border-border bg-card transition-shadow has-[textarea:focus-visible]:border-ring has-[textarea:focus-visible]:ring-2 has-[textarea:focus-visible]:ring-ring/20"
					/>
					<PendingCommentsList byFile={pendingByFile} count={pendingCommentCount} />
					<ActionSelector
						selected={effectiveEvent}
						onSelect={selectAction}
						disabled={isSubmitting}
						isOwnPullRequest={isOwnPullRequest}
					/>
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
						<Button size="sm" onClick={handleSubmit} disabled={!canSubmit} className="gap-1.5">
							{isSubmitting ? "Submitting…" : "Submit"}
							<kbd className="inline-flex items-center gap-0.5 rounded border border-primary-foreground/25 bg-primary-foreground/10 px-1 text-[10px]">
								{isMac ? "⌘" : "Ctrl"}
								<CornerDownLeft className="size-3" />
							</kbd>
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
