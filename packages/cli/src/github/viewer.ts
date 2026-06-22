import { z } from "zod";
import { gh } from "./exec.js";

const GhViewerSchema = z.object({
	login: z.string(),
	avatar_url: z.string().optional(),
});

export interface GitHubViewer {
	login: string;
	avatarUrl: string;
}

/**
 * The authenticated GitHub user via `gh api user`, or null when `gh` is missing,
 * unauthenticated, or offline. Never throws — the viewer is a display nicety, so
 * callers fall back to a local identity.
 */
export async function getGitHubViewer(repoRoot: string): Promise<GitHubViewer | null> {
	try {
		const stdout = await gh(["api", "user", "--jq", "{login,avatar_url}"], repoRoot);
		const parsed = GhViewerSchema.safeParse(JSON.parse(stdout));
		if (!parsed.success) return null;
		const { login, avatar_url } = parsed.data;
		return {
			login,
			avatarUrl: avatar_url || `https://github.com/${encodeURIComponent(login)}.png`,
		};
	} catch {
		return null;
	}
}
