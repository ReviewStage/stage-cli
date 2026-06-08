import type { Viewer } from "@stagereview/types/viewer";
import { readGitUserName, readRepoRoot } from "../git.js";
import { getGitHubViewer } from "../github/index.js";
import type { Route } from "../server.js";
import { writeJson } from "./json.js";

export function viewerRoutes(): Route[] {
	return [
		{
			method: "GET",
			pattern: "/api/viewer",
			handler: async (_req, res) => {
				writeJson(res, 200, await resolveViewer());
			},
		},
	];
}

// gh-authenticated user → git config user.name → a generic local label. Each step
// degrades silently, so the byline always has something to render.
async function resolveViewer(): Promise<Viewer> {
	const repoRoot = readRepoRoot();
	const ghViewer = await getGitHubViewer(repoRoot);
	// Show the GitHub login (e.g. "dastratakos"), not the display name.
	if (ghViewer) return { name: ghViewer.login, avatarUrl: ghViewer.avatarUrl };
	const gitName = readGitUserName(repoRoot);
	if (gitName) return { name: gitName, avatarUrl: null };
	return { name: "You", avatarUrl: null };
}
