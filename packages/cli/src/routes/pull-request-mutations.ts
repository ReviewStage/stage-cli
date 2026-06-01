import {
	type CollaboratorsResponse,
	PULL_REQUEST_MERGE_METHOD,
} from "@stagereview/types/pull-request";
import { z } from "zod";
import type { StageDb } from "../db/client.js";
import {
	addReviewers,
	closePullRequest,
	editTitle,
	listCollaborators,
	mergePullRequest,
	removeReviewers,
	reopenPullRequest,
	setAutoMerge,
	setDraft,
} from "../github/index.js";
import type { Route, RouteHandler } from "../server.js";
import { readJsonBody, writeJson } from "./json.js";
import { enforceSameOrigin, requireRepo, resolveRun } from "./pull-request-shared.js";

type Req = Parameters<RouteHandler>[0];
type Res = Parameters<RouteHandler>[1];

const numberField = z.number().int().positive();
const mergeMethod = z.enum(PULL_REQUEST_MERGE_METHOD);

const titleInput = z.object({ number: numberField, title: z.string().min(1) });
const numberInput = z.object({ number: numberField });
const draftInput = z.object({ number: numberField, draft: z.boolean() });
const mergeInput = z.object({
	number: numberField,
	mergeMethod,
	expectedHeadOid: z.string().optional(),
});
const autoMergeInput = z.object({
	number: numberField,
	enabled: z.boolean(),
	mergeMethod: mergeMethod.optional(),
	expectedHeadOid: z.string().optional(),
});
const reviewersInput = z.object({ number: numberField, reviewers: z.array(z.string()).min(1) });

async function parseBody<T>(req: Req, res: Res, schema: z.ZodType<T>): Promise<T | null> {
	let raw: unknown;
	try {
		raw = await readJsonBody(req);
	} catch {
		// Malformed JSON throws inside readJsonBody — return 400 rather than letting
		// it escape to the server's plain-text 500 catch-all.
		writeJson(res, 400, { error: "Invalid request body" });
		return null;
	}
	const parsed = schema.safeParse(raw);
	if (!parsed.success) {
		writeJson(res, 400, { error: "Invalid request body" });
		return null;
	}
	return parsed.data;
}

/** Run a gh write, surfacing failures as a 500 so the UI can toast the message. */
async function runMutation(res: Res, fn: () => Promise<void>): Promise<void> {
	try {
		await fn();
		writeJson(res, 200, { ok: true });
	} catch (err) {
		writeJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
	}
}

export function pullRequestMutationRoutes(db: StageDb): Route[] {
	return [
		{
			method: "PATCH",
			pattern: "/api/runs/:runId/pull-request/title",
			handler: async (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
				const run = resolveRun(db, params, res);
				if (!run) return;
				const input = await parseBody(req, res, titleInput);
				if (!input) return;
				await runMutation(res, () => editTitle(run.repoRoot, input.number, input.title));
			},
		},
		{
			method: "POST",
			pattern: "/api/runs/:runId/pull-request/close",
			handler: async (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
				const run = resolveRun(db, params, res);
				if (!run) return;
				const input = await parseBody(req, res, numberInput);
				if (!input) return;
				await runMutation(res, () => closePullRequest(run.repoRoot, input.number));
			},
		},
		{
			method: "POST",
			pattern: "/api/runs/:runId/pull-request/reopen",
			handler: async (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
				const run = resolveRun(db, params, res);
				if (!run) return;
				const input = await parseBody(req, res, numberInput);
				if (!input) return;
				await runMutation(res, () => reopenPullRequest(run.repoRoot, input.number));
			},
		},
		{
			method: "POST",
			pattern: "/api/runs/:runId/pull-request/draft",
			handler: async (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
				const run = resolveRun(db, params, res);
				if (!run) return;
				const input = await parseBody(req, res, draftInput);
				if (!input) return;
				await runMutation(res, () => setDraft(run.repoRoot, input.number, input.draft));
			},
		},
		{
			method: "POST",
			pattern: "/api/runs/:runId/pull-request/merge",
			handler: async (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
				const run = resolveRun(db, params, res);
				if (!run) return;
				const input = await parseBody(req, res, mergeInput);
				if (!input) return;
				await runMutation(res, () =>
					mergePullRequest(run.repoRoot, input.number, input.mergeMethod, input.expectedHeadOid),
				);
			},
		},
		{
			method: "POST",
			pattern: "/api/runs/:runId/pull-request/auto-merge",
			handler: async (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
				const run = resolveRun(db, params, res);
				if (!run) return;
				const input = await parseBody(req, res, autoMergeInput);
				if (!input) return;
				await runMutation(res, () =>
					setAutoMerge(
						run.repoRoot,
						input.number,
						input.enabled,
						input.mergeMethod,
						input.expectedHeadOid,
					),
				);
			},
		},
		{
			method: "POST",
			pattern: "/api/runs/:runId/pull-request/reviewers",
			handler: async (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
				const run = resolveRun(db, params, res);
				if (!run) return;
				const input = await parseBody(req, res, reviewersInput);
				if (!input) return;
				await runMutation(res, () => addReviewers(run.repoRoot, input.number, input.reviewers));
			},
		},
		{
			method: "DELETE",
			pattern: "/api/runs/:runId/pull-request/reviewers",
			handler: async (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
				const run = resolveRun(db, params, res);
				if (!run) return;
				const input = await parseBody(req, res, reviewersInput);
				if (!input) return;
				await runMutation(res, () => removeReviewers(run.repoRoot, input.number, input.reviewers));
			},
		},
		{
			method: "GET",
			pattern: "/api/runs/:runId/pull-request/collaborators",
			handler: async (_req, res, params) => {
				const run = resolveRun(db, params, res);
				if (!run) return;
				const repo = requireRepo(run, res);
				if (!repo) return;
				const collaborators = await listCollaborators(run.repoRoot, repo);
				const body: CollaboratorsResponse = { collaborators };
				writeJson(res, 200, body);
			},
		},
	];
}
