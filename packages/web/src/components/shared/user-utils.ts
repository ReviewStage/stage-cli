/** Minimal GitHub user shape used by display components. */
export interface GitHubUser {
	login: string;
	avatar_url: string;
	type?: string;
}

/** Derive the display name and profile URL from a GitHub user. */
export function getUserDisplay(user: GitHubUser) {
	const isBot = user.type === "Bot";
	const displayName = isBot ? user.login.replace("[bot]", "") : user.login;
	const profileUrl = isBot
		? `https://github.com/apps/${displayName}`
		: `https://github.com/${user.login}`;
	return { isBot, displayName, profileUrl };
}
