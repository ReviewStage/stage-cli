import { ChevronRight, Circle, CircleCheck, MessageSquare } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface ThreadCardProps {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	isResolved: boolean;
	onToggleResolved: () => void;
	/** Attribution for the thread's root comment. */
	byline: ReactNode;
	/** Header controls right of the byline (reply, source marker, action menu). */
	actions?: ReactNode;
	/** The thread body, revealed when the card is expanded. */
	children: ReactNode;
}

/**
 * The collapsible card every thread renders in — local notes and GitHub threads
 * alike. It owns the chrome (collapse trigger, resolve toggle, header layout) so
 * the two thread variants only differ in their byline, actions, and body.
 */
export function ThreadCard({
	isOpen,
	onOpenChange,
	isResolved,
	onToggleResolved,
	byline,
	actions,
	children,
}: ThreadCardProps) {
	return (
		<Collapsible open={isOpen} onOpenChange={onOpenChange}>
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
								className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
							>
								<ChevronRight className="size-3.5 transition-transform duration-200 [[data-state=open]>&]:rotate-90" />
							</CollapsibleTrigger>
						</TooltipTrigger>
						<TooltipContent>{isOpen ? "Collapse thread" : "Expand thread"}</TooltipContent>
					</Tooltip>
					<ResolveButton isResolved={isResolved} onToggle={onToggleResolved} />
					{byline}
					{actions}
				</div>
				<CollapsibleContent className="space-y-3 px-3 pb-3">{children}</CollapsibleContent>
			</div>
		</Collapsible>
	);
}

/** Opens a thread's reply composer. Shared by both thread variants' headers. */
export function ReplyButton({ onClick }: { onClick: () => void }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					variant="ghost"
					size="icon-xs"
					aria-label="Reply"
					className="rounded-md text-muted-foreground"
					onClick={onClick}
				>
					<MessageSquare className="size-3.5" />
				</Button>
			</TooltipTrigger>
			<TooltipContent>Reply</TooltipContent>
		</Tooltip>
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
					className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
