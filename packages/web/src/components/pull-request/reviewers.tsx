import {
	REVIEWER_STATUS,
	type Reviewer,
	type ReviewerStatus,
} from "@stagereview/types/pull-request";
import {
	Check,
	ChevronDown,
	Circle,
	Loader2,
	type LucideIcon,
	MessageSquare,
	Users,
	X,
} from "lucide-react";
import { useState } from "react";
import { BotBadge } from "@/components/shared/bot-badge";
import { ReviewerAvatars } from "@/components/shared/reviewer-avatars";
import { getUserDisplay } from "@/components/shared/user-utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePullRequestContext } from "@/lib/pull-request-context";
import { cn } from "@/lib/utils";

const STATUS_DESCRIPTIONS: Record<ReviewerStatus, string> = {
	[REVIEWER_STATUS.APPROVED]: "This reviewer approved these changes",
	[REVIEWER_STATUS.CHANGES_REQUESTED]: "This reviewer requested changes",
	[REVIEWER_STATUS.COMMENTED]: "This reviewer left comments",
	[REVIEWER_STATUS.DISMISSED]: "This review was dismissed",
	[REVIEWER_STATUS.PENDING]: "This reviewer hasn't submitted a review yet",
	[REVIEWER_STATUS.REQUESTED]: "Awaiting review from this reviewer",
};

const STATUS_ICONS: Record<ReviewerStatus, { icon: LucideIcon; className: string }> = {
	[REVIEWER_STATUS.APPROVED]: { icon: Check, className: "size-3.5 text-green-600" },
	[REVIEWER_STATUS.CHANGES_REQUESTED]: { icon: X, className: "size-3.5 text-destructive" },
	[REVIEWER_STATUS.COMMENTED]: { icon: MessageSquare, className: "size-3 text-muted-foreground" },
	[REVIEWER_STATUS.DISMISSED]: { icon: Circle, className: "size-3 text-muted-foreground" },
	[REVIEWER_STATUS.PENDING]: { icon: Circle, className: "size-3 text-muted-foreground" },
	[REVIEWER_STATUS.REQUESTED]: { icon: Circle, className: "size-3 text-muted-foreground" },
};

function StatusIcon({ status }: { status: ReviewerStatus }) {
	const { icon: Icon, className } = STATUS_ICONS[status];
	return <Icon className={className} />;
}

function ReviewerRow({ reviewer }: { reviewer: Reviewer }) {
	const { isBot, displayName, profileUrl } = getUserDisplay(reviewer.user);
	return (
		<div className="flex items-center justify-between gap-2 py-1.5">
			<div className="flex min-w-0 items-center gap-2">
				<a href={profileUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
					<Avatar className="size-6">
						<AvatarImage src={reviewer.user.avatar_url} alt={reviewer.user.login} />
						<AvatarFallback className="text-[9px]">
							{reviewer.user.login.charAt(0).toUpperCase()}
						</AvatarFallback>
					</Avatar>
				</a>
				<span className="flex min-w-0 items-center gap-1 text-sm">
					<a
						href={profileUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="truncate font-bold text-foreground hover:underline"
					>
						{displayName}
					</a>
					{isBot && <BotBadge className="shrink-0" />}
				</span>
			</div>
			<Tooltip>
				<TooltipTrigger asChild>
					<span className="inline-flex size-6 items-center justify-center">
						<StatusIcon status={reviewer.status} />
					</span>
				</TooltipTrigger>
				<TooltipContent>{STATUS_DESCRIPTIONS[reviewer.status]}</TooltipContent>
			</Tooltip>
		</div>
	);
}

export function Reviewers() {
	const [open, setOpen] = useState(false);
	const { reviews } = usePullRequestContext();
	const reviewers = reviews?.reviewers ?? [];

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-muted-foreground text-sm transition-colors hover:bg-muted/50"
				>
					<Users className="size-3.5 shrink-0" aria-hidden="true" />
					{reviews === null ? (
						<Loader2 className="size-3 animate-spin" />
					) : reviewers.length > 0 ? (
						<ReviewerAvatars reviewers={reviewers} size="md" />
					) : (
						<span className="text-muted-foreground/60 text-xs">No reviewers</span>
					)}
					<ChevronDown
						className={cn(
							"size-3 text-muted-foreground transition-transform duration-200",
							open && "rotate-180",
						)}
					/>
				</button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-72 p-0">
				<div className="divide-y divide-border">
					<div className="px-4 py-3">
						<h4 className="text-muted-foreground text-sm">Reviewers</h4>
					</div>
					{reviewers.length > 0 ? (
						<div className="px-4 py-3">
							{reviewers.map((reviewer) => (
								<ReviewerRow key={reviewer.user.login} reviewer={reviewer} />
							))}
						</div>
					) : (
						<p className="px-4 py-3 text-center text-muted-foreground text-xs">No reviewers yet</p>
					)}
				</div>
			</PopoverContent>
		</Popover>
	);
}
