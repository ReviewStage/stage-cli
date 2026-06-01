export interface GitHubRepo {
	owner: string;
	repo: string;
}

/**
 * Parse `owner`/`repo` from a github.com origin URL, or null for non-GitHub
 * remotes. Skips the `gh` invocation entirely for GitLab/Bitbucket/self-hosted
 * rather than shelling out only to have `gh` fail. Matches the URL shapes git
 * emits: git@github.com:owner/repo(.git), https://github.com/owner/repo(.git),
 * ssh://git@github.com/owner/repo(.git).
 */
export function parseGitHubRepo(originUrl: string | null): GitHubRepo | null {
	if (!originUrl) return null;
	const match = originUrl.match(/(?:^|@|\/\/)github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/);
	if (!match) return null;
	const [, owner, repo] = match;
	if (!owner || !repo) return null;
	return { owner, repo };
}

export function isGitHubRemote(originUrl: string | null): boolean {
	return parseGitHubRepo(originUrl) !== null;
}
