import { z } from "zod";
import type { StageDb } from "../db/client.js";
import {
	addLabelsToPullRequest,
	type GitHubLabel,
	listPullRequestLabels,
	listRepositoryLabels,
	removeLabelFromPullRequest,
} from "../github/index.js";
import type { Route, RouteHandler } from "../server.js";
import { parseJsonBody, writeJson } from "./json.js";
import {
	enforceSameOrigin,
	parseNumber,
	query,
	requireRepo,
	resolveRun,
} from "./pull-request-shared.js";

type Res = Parameters<RouteHandler>[1];

const numberField = z.number().int().positive();
// Mirrors hosted's `pullRequests.labels.add` / `.remove` inputs.
const addLabelsInput = z.object({
	number: numberField,
	labels: z.array(z.string().min(1)).min(1),
});
const removeLabelInput = z.object({ number: numberField, label: z.string().min(1) });

/** Run a gh write, surfacing failures as a 500 so the UI can toast the message. */
async function runMutation(res: Res, fn: () => Promise<void>): Promise<void> {
	try {
		await fn();
		writeJson(res, 200, { ok: true });
	} catch (err) {
		writeJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
	}
}

export function labelRoutes(db: StageDb): Route[] {
	return [
		{
			// The PR's current labels. Hosted reads these off its PR payload; the CLI's
			// PR wire shape has no labels, so they get their own read. Failures degrade
			// to `labels: null` (like the reviews read) so the header never breaks.
			method: "GET",
			pattern: "/api/runs/:runId/pull-request/labels",
			handler: async (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
				const run = resolveRun(db, params, res);
				if (!run) return;
				const repo = requireRepo(run, res);
				if (!repo) return;
				const number = parseNumber(query(req, "number"));
				if (number === null) {
					writeJson(res, 400, { error: "Missing or invalid `number` query parameter" });
					return;
				}
				let labels: GitHubLabel[] | null;
				try {
					labels = await listPullRequestLabels(run.repoRoot, repo, number);
				} catch {
					labels = null;
				}
				writeJson(res, 200, { labels });
			},
		},
		{
			// Hosted `pullRequests.labels.list`: every repository label, for the picker.
			// Errors surface so the picker can show its failed-load state.
			method: "GET",
			pattern: "/api/runs/:runId/pull-request/labels/repository",
			handler: async (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
				const run = resolveRun(db, params, res);
				if (!run) return;
				const repo = requireRepo(run, res);
				if (!repo) return;
				try {
					writeJson(res, 200, { labels: await listRepositoryLabels(run.repoRoot, repo) });
				} catch (err) {
					writeJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
				}
			},
		},
		{
			// Hosted `pullRequests.labels.add`.
			method: "POST",
			pattern: "/api/runs/:runId/pull-request/labels",
			handler: async (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
				const run = resolveRun(db, params, res);
				if (!run) return;
				const repo = requireRepo(run, res);
				if (!repo) return;
				const input = await parseJsonBody(req, res, addLabelsInput);
				if (!input) return;
				await runMutation(res, () =>
					addLabelsToPullRequest(run.repoRoot, repo, input.number, input.labels),
				);
			},
		},
		{
			// Hosted `pullRequests.labels.remove`.
			method: "DELETE",
			pattern: "/api/runs/:runId/pull-request/labels",
			handler: async (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
				const run = resolveRun(db, params, res);
				if (!run) return;
				const repo = requireRepo(run, res);
				if (!repo) return;
				const input = await parseJsonBody(req, res, removeLabelInput);
				if (!input) return;
				await runMutation(res, () =>
					removeLabelFromPullRequest(run.repoRoot, repo, input.number, input.label),
				);
			},
		},
	];
}
