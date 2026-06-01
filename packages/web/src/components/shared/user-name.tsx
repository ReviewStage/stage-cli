import { BotBadge } from "@/components/shared/bot-badge";
import { type GitHubUser, getUserDisplay } from "@/components/shared/user-utils";

export { type GitHubUser, getUserDisplay } from "@/components/shared/user-utils";

interface UserNameProps {
	user: GitHubUser;
}

/** Renders a username link with an inline bot badge when applicable. */
export function UserName({ user }: UserNameProps) {
	const { isBot, displayName, profileUrl } = getUserDisplay(user);
	return (
		<>
			<a
				href={profileUrl}
				target="_blank"
				rel="noopener noreferrer"
				className="font-bold text-foreground hover:underline"
			>
				{displayName}
			</a>
			{isBot && <BotBadge className="ml-1 align-middle" />}
		</>
	);
}
