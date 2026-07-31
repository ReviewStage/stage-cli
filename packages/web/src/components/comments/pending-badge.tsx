import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Amber marker for review comments that haven't reached the PR yet — on a
 * thread header ("Pending") and on the review toolbar's count ("3 pending").
 */
export function PendingBadge({ children }: { children: ReactNode }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Badge
					variant="outline"
					className="shrink-0 border-amber-600/30 text-amber-700 dark:border-amber-500/30 dark:text-amber-500"
				>
					{children}
				</Badge>
			</TooltipTrigger>
			<TooltipContent>Posts to the pull request when you finish your review</TooltipContent>
		</Tooltip>
	);
}
