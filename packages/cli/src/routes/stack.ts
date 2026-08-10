import type { PullRequestStackResponse } from "@stagereview/types";
import { desc, inArray } from "drizzle-orm";
import type { StageDb } from "../db/client.js";
import { chapterRun } from "../db/schema/index.js";
import { type GitHubRepo, parseGitHubRepo } from "../github/index.js";
import { getPullRequestStack } from "../github/pull-request-stack.js";
import type { Route } from "../server.js";
import { writeJson } from "./json.js";
import { parseNumber, query, requireRepo, resolveRun } from "./pull-request-shared.js";

/** GitHub owner/repo names are case-insensitive, and remote URLs vary in casing. */
function isSameRepo(a: GitHubRepo, b: GitHubRepo): boolean {
	return (
		a.owner.toLowerCase() === b.owner.toLowerCase() && a.repo.toLowerCase() === b.repo.toLowerCase()
	);
}

/**
 * Latest local run per PR number, restricted to runs whose origin points at
 * the same GitHub repo. Only `--pr` runs record a prNumber, so branch-detected
 * runs never match — attributing those to a PR would take a live gh lookup per
 * run.
 */
function latestRunIdByPrNumber(
	db: StageDb,
	repo: GitHubRepo,
	numbers: number[],
): Map<number, string> {
	const byNumber = new Map<number, string>();
	if (numbers.length === 0) return byNumber;
	const rows = db
		.select({ id: chapterRun.id, originUrl: chapterRun.originUrl, prNumber: chapterRun.prNumber })
		.from(chapterRun)
		.where(inArray(chapterRun.prNumber, numbers))
		.orderBy(desc(chapterRun.createdAt))
		.all();
	for (const row of rows) {
		if (row.prNumber === null || byNumber.has(row.prNumber)) continue;
		const runRepo = parseGitHubRepo(row.originUrl);
		if (!runRepo || !isSameRepo(runRepo, repo)) continue;
		byNumber.set(row.prNumber, row.id);
	}
	return byNumber;
}

export function stackRoutes(db: StageDb): Route[] {
	return [
		{
			method: "GET",
			pattern: "/api/runs/:runId/pull-request/stack",
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
				const entries = await getPullRequestStack(run.repoRoot, repo, number);
				const runIds = latestRunIdByPrNumber(
					db,
					repo,
					entries.map((entry) => entry.number),
				);
				const body: PullRequestStackResponse = {
					stack: entries.map((entry) => ({
						...entry,
						runId: runIds.get(entry.number) ?? null,
					})),
				};
				writeJson(res, 200, body);
			},
		},
	];
}
