import {
	REACTION_CONTENT,
	type ReactionContentKey,
	type ReactionUserMap,
} from "@stagereview/types";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Read-only: reaction toggling needs a mutation backend the CLI doesn't have,
// so there is no add-reaction button and no toggle handlers.

export const REACTION_EMOJI: Record<ReactionContentKey, { emoji: string; label: string }> = {
	[REACTION_CONTENT.THUMBS_UP]: { emoji: "👍", label: "thumbs up" },
	[REACTION_CONTENT.THUMBS_DOWN]: { emoji: "👎", label: "thumbs down" },
	[REACTION_CONTENT.LAUGH]: { emoji: "😄", label: "laugh" },
	[REACTION_CONTENT.HOORAY]: { emoji: "🎉", label: "hooray" },
	[REACTION_CONTENT.CONFUSED]: { emoji: "😕", label: "confused" },
	[REACTION_CONTENT.HEART]: { emoji: "❤️", label: "heart" },
	[REACTION_CONTENT.ROCKET]: { emoji: "🚀", label: "rocket" },
	[REACTION_CONTENT.EYES]: { emoji: "👀", label: "eyes" },
};

const REACTION_KEYS = Object.values(REACTION_CONTENT);

interface ReactionBarProps {
	reactions?: ReactionUserMap;
}

export function ReactionBar({ reactions }: ReactionBarProps) {
	if (!reactions) return null;
	const hasReactions = REACTION_KEYS.some((key) => {
		const users = reactions[key];
		return users && users.length > 0;
	});
	if (!hasReactions) return null;

	return (
		<div className="mt-2 flex flex-wrap gap-1.5">
			{REACTION_KEYS.map((key) => {
				const users = reactions[key];
				if (!users || users.length === 0) return null;
				return <ReactionBadge key={key} reactionKey={key} users={users} />;
			})}
		</div>
	);
}

interface ReactionBadgeProps {
	reactionKey: ReactionContentKey;
	users: string[];
}

function ReactionBadge({ reactionKey, users }: ReactionBadgeProps) {
	const { emoji, label } = REACTION_EMOJI[reactionKey];

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Badge
					variant="outline"
					className="h-6 gap-1 px-2 py-0.5 text-xs"
					aria-label={`${users.length} ${label}`}
					tabIndex={0}
				>
					<span aria-hidden="true">{emoji}</span>
					<span>{users.length}</span>
				</Badge>
			</TooltipTrigger>
			<TooltipContent>
				{users.length <= 10
					? users.join(", ")
					: `${users.slice(0, 10).join(", ")} and ${users.length - 10} more`}
			</TooltipContent>
		</Tooltip>
	);
}
