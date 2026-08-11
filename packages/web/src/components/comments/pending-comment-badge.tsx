import { Badge } from "@/components/ui/badge";

export const PENDING_COMMENT_BADGE_CN =
	"border-yellow-500/50 bg-yellow-50 text-yellow-800 dark:bg-yellow-950/20 dark:text-yellow-200";

export function PendingCommentBadge() {
	return (
		<Badge variant="outline" className={PENDING_COMMENT_BADGE_CN}>
			Pending
		</Badge>
	);
}
