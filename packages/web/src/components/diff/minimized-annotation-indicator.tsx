import { Circle, CircleCheck, MessageSquare, User } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ReviewThread } from "@/lib/use-review";
import { useViewer } from "@/lib/use-viewer";
import { cn } from "@/lib/utils";

const MAX_VISIBLE_AVATARS = 4;

interface MinimizedAnnotationIndicatorProps {
	threads: ReviewThread[];
	onClick: () => void;
	isExpanded?: boolean;
}

interface AnnotationUser {
	name: string;
	avatarUrl: string | null;
}

/**
 * The single compact chip shown for a minimized annotation row. It merges every
 * comment thread on the line into one summary — author avatars + a comment count +
 * a resolved indicator.
 */
export function MinimizedAnnotationIndicator({
	threads,
	onClick,
	isExpanded = false,
}: MinimizedAnnotationIndicatorProps) {
	const viewer = useViewer();

	const uniqueUsers = getUniqueUsers(threads, viewer);
	const commentCount = threads.reduce((sum, thread) => sum + thread.comments.length, 0);
	const allResolved = threads.length > 0 && threads.every((thread) => thread.isResolved);

	const summary = `${commentCount} inline comment${commentCount === 1 ? "" : "s"}`;

	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={`${summary} — click to ${isExpanded ? "collapse" : "expand"}`}
			className="flex cursor-pointer items-center gap-1.5 rounded-md border border-transparent px-1 py-0.5 transition-colors hover:border-border hover:bg-accent"
		>
			{allResolved ? (
				<CircleCheck className="size-3 text-green-600" />
			) : (
				<Circle className="size-3 text-muted-foreground" />
			)}
			{uniqueUsers.slice(0, MAX_VISIBLE_AVATARS).map((user, index) => (
				<Tooltip key={user.name}>
					<TooltipTrigger asChild>
						<span
							className={cn("relative inline-flex shrink-0", index > 0 && "-ml-2.5")}
							style={{ zIndex: uniqueUsers.length - index }}
						>
							<Avatar className="size-5 ring-1 ring-border">
								{user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.name} />}
								<AvatarFallback className="text-[10px]">
									<User className="size-3" />
								</AvatarFallback>
							</Avatar>
						</span>
					</TooltipTrigger>
					<TooltipContent>{user.name}</TooltipContent>
				</Tooltip>
			))}
			{uniqueUsers.length > MAX_VISIBLE_AVATARS && (
				<span className="text-xs text-muted-foreground">
					+{uniqueUsers.length - MAX_VISIBLE_AVATARS}
				</span>
			)}
			{commentCount > 0 && (
				<span className="flex items-center gap-0.5 text-xs text-muted-foreground">
					<MessageSquare className="size-3" />
					{commentCount}
				</span>
			)}
		</button>
	);
}

// Local comments (author null) render as the local reviewer; GitHub comments show
// their author. Mirrors the byline attribution in review-thread.tsx.
function getUniqueUsers(threads: ReviewThread[], viewer: AnnotationUser): AnnotationUser[] {
	const seen = new Set<string>();
	const users: AnnotationUser[] = [];
	for (const thread of threads) {
		for (const comment of thread.comments) {
			const user: AnnotationUser = comment.author
				? { name: comment.author.login, avatarUrl: comment.author.avatarUrl }
				: viewer;
			if (!seen.has(user.name)) {
				seen.add(user.name);
				users.push(user);
			}
		}
	}
	return users;
}
