import type { PullRequestStackResponse } from "@stagereview/types";
import { and, desc, inArray, isNull, or } from "drizzle-orm";
import type { StageDb } from "../db/client.js";
import { chapterRun } from "../db/schema/index.js";
import { type GitHubRepo, parseGitHubRepo } from "../github/index.js";
import { getPullRequestStack, type PullRequestStackEntry } from "../github/pull-request-stack.js";
import type { Route } from "../server.js";
import { writeJson } from "./json.js";
import {
	enforceSameOrigin,
	parseNumber,
	query,
	requireRepo,
	resolveRun,
} from "./pull-request-shared.js";

/** GitHub owner/repo names are case-insensitive, and remote URLs vary in casing. */
function isSameRepo(a: GitHubRepo, b: GitHubRepo): boolean {
	return (
		a.owner.toLowerCase() === b.owner.toLowerCase() && a.repo.toLowerCase() === b.repo.toLowerCase()
	);
}

/** Local runs attached to stack entries, keyed the way each run kind matches. */
interface StackRunAttachments {
	/** Latest `--pr` run per stored PR number. */
	byPrNumber: Map<number, string>;
	/** Latest branch-detected run (no stored number) per import-time branch. */
	byHeadRef: Map<string, string>;
}

/**
 * Latest local run per stack entry, restricted to runs whose origin points at
 * the same GitHub repo. `--pr` runs attach by their stored prNumber; branch-
 * detected runs attach by the branch recorded at import (`headRef`) matching
 * an entry's head branch. Legacy rows with neither never attach.
 */
function latestRunIdsForEntries(
	db: StageDb,
	repo: GitHubRepo,
	entries: PullRequestStackEntry[],
): StackRunAttachments {
	const byPrNumber = new Map<number, string>();
	const byHeadRef = new Map<string, string>();
	if (entries.length === 0) return { byPrNumber, byHeadRef };
	const rows = db
		.select({
			id: chapterRun.id,
			originUrl: chapterRun.originUrl,
			prNumber: chapterRun.prNumber,
			headRef: chapterRun.headRef,
		})
		.from(chapterRun)
		.where(
			or(
				inArray(
					chapterRun.prNumber,
					entries.map((entry) => entry.number),
				),
				and(
					isNull(chapterRun.prNumber),
					inArray(
						chapterRun.headRef,
						entries.map((entry) => entry.headRef),
					),
				),
			),
		)
		.orderBy(desc(chapterRun.createdAt))
		.all();
	for (const row of rows) {
		const runRepo = parseGitHubRepo(row.originUrl);
		if (!runRepo || !isSameRepo(runRepo, repo)) continue;
		if (row.prNumber !== null) {
			if (!byPrNumber.has(row.prNumber)) byPrNumber.set(row.prNumber, row.id);
		} else if (row.headRef !== null && !byHeadRef.has(row.headRef)) {
			byHeadRef.set(row.headRef, row.id);
		}
	}
	return { byPrNumber, byHeadRef };
}

export function stackRoutes(db: StageDb): Route[] {
	return [
		{
			method: "GET",
			pattern: "/api/runs/:runId/pull-request/stack",
			handler: async (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
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
				const runIds = latestRunIdsForEntries(db, repo, entries);
				const body: PullRequestStackResponse = {
					stack: entries.map((entry) => ({
						...entry,
						// A stored prNumber is authoritative; headRef only attaches
						// branch-detected runs, which never carry a number.
						runId:
							runIds.byPrNumber.get(entry.number) ?? runIds.byHeadRef.get(entry.headRef) ?? null,
					})),
				};
				writeJson(res, 200, body);
			},
		},
	];
}
