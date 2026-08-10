import type { ReactionUserMap } from "@stagereview/types";
import { MessageSquare } from "lucide-react";
import type { GitHubUser } from "@/components/shared/user-utils";
import { CommentBody } from "./comment-body";
import { CommentHeader } from "./comment-header";
import { ReactionBar } from "./reaction-bar";

// Vendored from hosted Stage's `conversation/comment-card.tsx`, read-only:
// issue-comment edit/delete mutations are hosted-only concerns and are dropped.

interface CommentCardProps {
	user: GitHubUser;
	body: string;
	bodyHtml?: string | null;
	createdAt: string;
	updatedAt?: string;
	htmlUrl: string;
	reactions?: ReactionUserMap;
	appAvatarUrl?: string;
	appUrl?: string;
}

export function CommentCard({
	user,
	body,
	bodyHtml,
	createdAt,
	updatedAt,
	htmlUrl,
	reactions,
	appAvatarUrl,
	appUrl,
}: CommentCardProps) {
	return (
		<CommentHeader
			user={user}
			createdAt={createdAt}
			updatedAt={updatedAt}
			htmlUrl={htmlUrl}
			appAvatarUrl={appAvatarUrl}
			appUrl={appUrl}
			icon={
				<span className="flex size-6 items-center justify-center rounded-full bg-muted text-muted-foreground">
					<MessageSquare className="size-3" />
				</span>
			}
			action="commented"
		>
			<CommentBody body={body} bodyHtml={bodyHtml} />
			<ReactionBar reactions={reactions} />
		</CommentHeader>
	);
}
