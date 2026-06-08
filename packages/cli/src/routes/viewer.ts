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

const FALLBACK_VIEWER: Viewer = { name: "You", avatarUrl: null };

// gh-authenticated user → git config user.name → a generic local label. Every
// step degrades to the fallback, so the byline always has something to render.
async function resolveViewer(): Promise<Viewer> {
	let repoRoot: string;
	try {
		repoRoot = readRepoRoot();
	} catch {
		return FALLBACK_VIEWER;
	}
	const ghViewer = await getGitHubViewer(repoRoot);
	if (ghViewer) return { name: ghViewer.login, avatarUrl: ghViewer.avatarUrl };
	const gitName = readGitUserName(repoRoot);
	if (gitName) return { name: gitName, avatarUrl: null };
	return FALLBACK_VIEWER;
}
