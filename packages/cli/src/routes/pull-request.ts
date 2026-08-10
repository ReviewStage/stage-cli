import type {
	ChecksResponse,
	MergeStatusResponse,
	PullRequestResponse,
	ReviewsResponse,
} from "@stagereview/types/pull-request";
import type { StageDb } from "../db/client.js";
import {
	getChecks,
	getMergeStatus,
	getPullRequest,
	getPullRequestOrThrow,
	getReviews,
} from "../github/index.js";
import type { Route } from "../server.js";
import { writeJson } from "./json.js";
import { parseNumber, query, requireRepo, resolveRun } from "./pull-request-shared.js";

const SHA_RE = /^[0-9a-f]{40}$/i;

export function pullRequestRoutes(db: StageDb): Route[] {
	return [
		{
			method: "GET",
			pattern: "/api/runs/:runId/pull-request",
			handler: async (_req, res, params) => {
				const run = resolveRun(db, params, res);
				if (!run) return;
				// Explicit --pr runs must surface lookup failures (auth, offline,
				// malformed output) instead of degrading to null, which the UI
				// would misread as "this run has no PR". Branch runs keep the
				// tolerant lookup so local browsing never breaks.
				if (run.prNumber !== null) {
					try {
						const pullRequest = await getPullRequestOrThrow(
							run.repoRoot,
							run.originUrl,
							run.prNumber,
						);
						writeJson(res, 200, { pullRequest } satisfies PullRequestResponse);
					} catch (err) {
						const message = err instanceof Error ? err.message : "Failed to load pull request";
						console.error(`Failed to load pull request: ${message}`);
						writeJson(res, 502, { error: message });
					}
					return;
				}
				const pullRequest = await getPullRequest(run.repoRoot, run.originUrl, run.prNumber);
				const body: PullRequestResponse = { pullRequest };
				writeJson(res, 200, body);
			},
		},
		{
			method: "GET",
			pattern: "/api/runs/:runId/pull-request/checks",
			handler: async (req, res, params) => {
				const run = resolveRun(db, params, res);
				if (!run) return;
				const repo = requireRepo(run, res);
				if (!repo) return;
				const headSha = query(req, "headSha");
				if (!headSha || !SHA_RE.test(headSha)) {
					writeJson(res, 400, { error: "Missing or invalid headSha" });
					return;
				}
				const body: ChecksResponse = await getChecks(run.repoRoot, repo, headSha);
				writeJson(res, 200, body);
			},
		},
		{
			method: "GET",
			pattern: "/api/runs/:runId/pull-request/reviews",
			handler: async (req, res, params) => {
				const run = resolveRun(db, params, res);
				if (!run) return;
				const repo = requireRepo(run, res);
				if (!repo) return;
				const number = parseNumber(query(req, "number"));
				if (number === null) {
					writeJson(res, 400, { error: "Missing or invalid number" });
					return;
				}
				const reviews = await getReviews(run.repoRoot, repo, number);
				const body: ReviewsResponse = { reviews };
				writeJson(res, 200, body);
			},
		},
		{
			method: "GET",
			pattern: "/api/runs/:runId/pull-request/merge-status",
			handler: async (req, res, params) => {
				const run = resolveRun(db, params, res);
				if (!run) return;
				const repo = requireRepo(run, res);
				if (!repo) return;
				const number = parseNumber(query(req, "number"));
				if (number === null) {
					writeJson(res, 400, { error: "Missing or invalid number" });
					return;
				}
				const mergeStatus = await getMergeStatus(run.repoRoot, repo, number);
				const body: MergeStatusResponse = { mergeStatus };
				writeJson(res, 200, body);
			},
		},
	];
}
