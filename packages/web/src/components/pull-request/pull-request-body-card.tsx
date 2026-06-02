import type { GitHubPullRequest } from "@stagereview/types/pull-request";
import { MessageSquare } from "lucide-react";
import { UserName } from "@/components/shared/user-name";
import { getUserDisplay } from "@/components/shared/user-utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Markdown } from "@/components/ui/markdown";
import { formatTimeAgo } from "@/lib/format";

/**
 * The PR description rendered as a GitHub-style comment: author avatar/header
 * plus the markdown body. Mirrors hosted Stage's PullRequestBodyCard, minus the
 * write/reaction affordances the CLI doesn't carry.
 */
export function PullRequestBodyCard({ pullRequest }: { pullRequest: GitHubPullRequest }) {
	const user = pullRequest.user;
	if (!user) return null;

	const { profileUrl } = getUserDisplay(user);
	const hasBody = pullRequest.body.trim().length > 0;

	return (
		<div className="flex items-start gap-3">
			<a href={profileUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
				<Avatar className="size-8">
					<AvatarImage src={user.avatar_url} alt={user.login} />
					<AvatarFallback className="text-xs">{user.login[0]?.toUpperCase()}</AvatarFallback>
				</Avatar>
			</a>
			<div className="min-w-0 flex-1">
				<p className="mb-1 text-muted-foreground text-sm">
					<span className="mr-1.5 inline-flex size-6 items-center justify-center rounded-full bg-muted align-middle text-muted-foreground">
						<MessageSquare className="size-3" />
					</span>
					<UserName user={user} /> commented{" "}
					<a
						href={pullRequest.html_url}
						target="_blank"
						rel="noopener noreferrer"
						className="hover:underline"
					>
						<time
							dateTime={pullRequest.created_at}
							title={new Date(pullRequest.created_at).toLocaleString()}
						>
							{formatTimeAgo(pullRequest.created_at)}
						</time>
					</a>
				</p>
				{hasBody ? (
					<Markdown content={pullRequest.body} allowHtml />
				) : (
					<p className="text-muted-foreground text-sm italic">No description provided.</p>
				)}
			</div>
		</div>
	);
}
