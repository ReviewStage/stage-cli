import type { GitHubThreadsResponse } from "@stagereview/types/github-threads";
import type { StageDb } from "../db/client.js";
import { parseGitHubRepo } from "../github/index.js";
import { fetchReviewThreads } from "../github/review-comments.js";
import type { Route } from "../server.js";
import { writeJson } from "./json.js";
import { resolveRun } from "./pull-request-shared.js";

const UNAVAILABLE: GitHubThreadsResponse = { available: false, threads: [] };

/**
 * Live-fetch routes for GitHub review threads. GitHub stays the source of
 * truth for its own threads — they're never mirrored into the local DB, so
 * every read here goes straight to `gh`. This file will grow submit-review,
 * reply, and resolve/unresolve mutations in a later task.
 */
export function gitHubThreadRoutes(db: StageDb): Route[] {
	return [
		{
			method: "GET",
			pattern: "/api/runs/:runId/github-threads",
			handler: async (_req, res, params) => {
				const run = resolveRun(db, params, res);
				if (!run) return;
				const repo = parseGitHubRepo(run.originUrl);
				if (!repo || run.prNumber === null) {
					writeJson(res, 200, UNAVAILABLE);
					return;
				}
				const threads = await fetchReviewThreads(run.repoRoot, repo, run.prNumber, run.headSha);
				if (threads === null) {
					writeJson(res, 200, UNAVAILABLE);
					return;
				}
				writeJson(res, 200, { available: true, threads } satisfies GitHubThreadsResponse);
			},
		},
	];
}
