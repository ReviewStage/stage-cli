import type { Reviewer, ReviewerStatus } from "@stagereview/types/pull-request";
import { REVIEWER_STATUS } from "@stagereview/types/pull-request";
import { Check, Circle, MessageSquare, X } from "lucide-react";

import type { AvatarStackSize } from "@/components/shared/avatar-stack";
import { AvatarStack } from "@/components/shared/avatar-stack";

export const REVIEWER_STATUS_LABELS: Record<ReviewerStatus, string> = {
	[REVIEWER_STATUS.APPROVED]: "Approved",
	[REVIEWER_STATUS.CHANGES_REQUESTED]: "Changes requested",
	[REVIEWER_STATUS.COMMENTED]: "Commented",
	[REVIEWER_STATUS.DISMISSED]: "Dismissed",
	[REVIEWER_STATUS.PENDING]: "Pending",
	[REVIEWER_STATUS.REQUESTED]: "Review requested",
};

function getStatusIndicator(status: ReviewerStatus) {
	switch (status) {
		case REVIEWER_STATUS.APPROVED:
			return <Check className="size-2.5 text-green-600" />;
		case REVIEWER_STATUS.CHANGES_REQUESTED:
			return <X className="size-2.5 text-destructive" />;
		case REVIEWER_STATUS.COMMENTED:
			return <MessageSquare className="size-2 text-muted-foreground" />;
		default:
			return <Circle className="size-2 text-muted-foreground" />;
	}
}

/** Filters out the pull request author and sorts bots to the end. */
export function filterAndSortReviewers(reviewers: Reviewer[], authorLogin?: string): Reviewer[] {
	return reviewers
		.filter((r) => r.user.login !== authorLogin)
		.sort((a, b) => {
			const aBot = a.user.type === "Bot" ? 1 : 0;
			const bBot = b.user.type === "Bot" ? 1 : 0;
			return aBot - bBot;
		});
}

interface ReviewerAvatarsProps {
	reviewers: Reviewer[];
	size?: AvatarStackSize;
	className?: string;
	hoverSpread?: boolean;
}

export function ReviewerAvatars({
	reviewers,
	size = "md",
	className,
	hoverSpread = false,
}: ReviewerAvatarsProps) {
	const items = reviewers.map((reviewer) => ({
		key: reviewer.user.login,
		avatarUrl: reviewer.user.avatar_url,
		alt: reviewer.user.login,
		tooltip: `${reviewer.user.login} — ${REVIEWER_STATUS_LABELS[reviewer.status]}`,
		badge: reviewer.user.type !== "Bot" ? getStatusIndicator(reviewer.status) : undefined,
	}));

	return <AvatarStack items={items} size={size} hoverSpread={hoverSpread} className={className} />;
}
