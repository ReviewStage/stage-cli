import path from "node:path";
import type {
	ChecksResponse,
	MergeStatusResponse,
	PullRequestResponse,
	ReviewsResponse,
} from "@stagereview/types/pull-request";
import { eq } from "drizzle-orm";
import type { StageDb } from "../db/client.js";
import { chapterRun } from "../db/schema/index.js";
import {
	type GitHubRepo,
	getChecks,
	getMergeStatus,
	getPullRequest,
	getReviews,
	parseGitHubRepo,
} from "../github/index.js";
import type { Route, RouteHandler, RouteParams } from "../server.js";
import { writeJson } from "./json.js";

interface RunRepo {
	repoRoot: string;
	originUrl: string | null;
}

/** Resolve a run's repo context, writing the matching error response on failure. */
function resolveRun(
	db: StageDb,
	params: RouteParams,
	res: Parameters<RouteHandler>[1],
): RunRepo | null {
	const runId = params.runId;
	if (!runId) {
		writeJson(res, 400, { error: "Missing runId" });
		return null;
	}
	const [run] = db.select().from(chapterRun).where(eq(chapterRun.id, runId)).limit(1).all();
	if (!run) {
		writeJson(res, 404, { error: `Run ${runId} not found` });
		return null;
	}
	const repoRoot = run.repoRoot;
	if (!path.isAbsolute(repoRoot) || repoRoot.split(path.sep).includes("..")) {
		writeJson(res, 500, {
			error: "Run repoRoot is not an absolute path or contains traversal segments",
		});
		return null;
	}
	return { repoRoot, originUrl: run.originUrl };
}

function requireRepo(run: RunRepo, res: Parameters<RouteHandler>[1]): GitHubRepo | null {
	const repo = parseGitHubRepo(run.originUrl);
	if (!repo) {
		writeJson(res, 404, { error: "Run is not associated with a GitHub remote" });
		return null;
	}
	return repo;
}

function query(req: Parameters<RouteHandler>[0], key: string): string | null {
	const url = req.url ?? "";
	const qIdx = url.indexOf("?");
	if (qIdx < 0) return null;
	return new URLSearchParams(url.slice(qIdx + 1)).get(key);
}

function parseNumber(value: string | null): number | null {
	if (value === null) return null;
	const n = Number(value);
	return Number.isInteger(n) && n > 0 ? n : null;
}

const SHA_RE = /^[0-9a-f]{40}$/i;

export function pullRequestRoutes(db: StageDb): Route[] {
	return [
		{
			method: "GET",
			pattern: "/api/runs/:runId/pull-request",
			handler: async (_req, res, params) => {
				const run = resolveRun(db, params, res);
				if (!run) return;
				const pullRequest = await getPullRequest(run.repoRoot, run.originUrl);
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
