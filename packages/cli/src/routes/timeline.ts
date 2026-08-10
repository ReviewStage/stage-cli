import type { TimelineResponse } from "@stagereview/types";
import type { StageDb } from "../db/client.js";
import { getPullRequestTimeline } from "../github/timeline.js";
import type { Route } from "../server.js";
import { writeJson } from "./json.js";
import {
	enforceSameOrigin,
	parseNumber,
	query,
	requireRepo,
	resolveRun,
} from "./pull-request-shared.js";

export function timelineRoutes(db: StageDb): Route[] {
	return [
		{
			method: "GET",
			pattern: "/api/runs/:runId/timeline",
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
				try {
					const timeline = await getPullRequestTimeline(run.repoRoot, repo, number);
					const body: TimelineResponse = { timeline };
					writeJson(res, 200, body);
				} catch (err) {
					// gh missing/unauthenticated/offline — degrade with an error the UI can show
					writeJson(res, 502, {
						error: err instanceof Error ? err.message : "Failed to load timeline",
					});
				}
			},
		},
	];
}
