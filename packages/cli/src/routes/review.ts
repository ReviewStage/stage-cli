import {
	AddToReviewBodySchema,
	GitHubCommentDeleteBodySchema,
	GitHubCommentEditBodySchema,
	GitHubReplyBodySchema,
	GitHubResolveBodySchema,
	SubmitReviewBodySchema,
} from "@stagereview/types/review";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import type { StageDb } from "../db/client.js";
import { type ChapterRunRow, chapterRun } from "../db/schema/index.js";
import {
	addLocalThreadToReview,
	deleteGitHubComment,
	discardRunReview,
	editGitHubComment,
	getReviewForRun,
	ReviewError,
	replyToGitHubThread,
	resolveGitHubThread,
	submitRunReview,
} from "../runs/review.js";
import type { Route, RouteHandler } from "../server.js";
import { parseJsonBody, writeJson } from "./json.js";
import { enforceSameOrigin } from "./pull-request-shared.js";

type Req = Parameters<RouteHandler>[0];
type Res = Parameters<RouteHandler>[1];

export function reviewRoutes(db: StageDb): Route[] {
	return [
		{
			method: "GET",
			pattern: "/api/runs/:runId/review",
			handler: (_req, res, params) =>
				withRun(db, params.runId, res, (run) => getReviewForRun(db, run)),
		},
		{
			method: "POST",
			pattern: "/api/runs/:runId/review/add",
			handler: (req, res, params) =>
				withRunBody(db, req, res, params.runId, AddToReviewBodySchema, (run, body) =>
					addLocalThreadToReview(db, run, body.localThreadId),
				),
		},
		{
			method: "POST",
			pattern: "/api/runs/:runId/review/submit",
			handler: (req, res, params) =>
				withRunBody(db, req, res, params.runId, SubmitReviewBodySchema, (run, body) =>
					submitRunReview(run, body.event, body.body),
				),
		},
		{
			method: "POST",
			pattern: "/api/runs/:runId/review/discard",
			handler: (req, res, params) =>
				withRun(db, params.runId, res, (run) => discardRunReview(run), { sameOrigin: req }),
		},
		{
			method: "POST",
			pattern: "/api/runs/:runId/review/reply",
			handler: (req, res, params) =>
				withRunBody(db, req, res, params.runId, GitHubReplyBodySchema, (run, body) =>
					replyToGitHubThread(run, body.threadNodeId, body.body, body.pending),
				),
		},
		{
			method: "POST",
			pattern: "/api/runs/:runId/review/comment/edit",
			handler: (req, res, params) =>
				withRunBody(db, req, res, params.runId, GitHubCommentEditBodySchema, (run, body) =>
					editGitHubComment(run, body.nodeId, body.body),
				),
		},
		{
			method: "POST",
			pattern: "/api/runs/:runId/review/comment/delete",
			handler: (req, res, params) =>
				withRunBody(db, req, res, params.runId, GitHubCommentDeleteBodySchema, (run, body) =>
					deleteGitHubComment(run, body.nodeId),
				),
		},
		{
			method: "POST",
			pattern: "/api/runs/:runId/review/resolve",
			handler: (req, res, params) =>
				withRunBody(db, req, res, params.runId, GitHubResolveBodySchema, (run, body) =>
					resolveGitHubThread(run, body.threadNodeId, body.resolved),
				),
		},
	];
}

function loadRun(db: StageDb, runId: string | undefined, res: Res): ChapterRunRow | null {
	if (!runId) {
		writeJson(res, 400, { error: "Missing runId" });
		return null;
	}
	const [run] = db.select().from(chapterRun).where(eq(chapterRun.id, runId)).limit(1).all();
	if (!run) {
		writeJson(res, 404, { error: `Run ${runId} not found` });
		return null;
	}
	return run;
}

async function respond(res: Res, action: () => Promise<unknown>): Promise<void> {
	try {
		writeJson(res, 200, (await action()) ?? {});
	} catch (err) {
		if (err instanceof ReviewError) {
			writeJson(res, err.status, { error: err.message });
			return;
		}
		writeJson(res, 500, {
			error: err instanceof Error ? err.message : "Review action failed",
		});
	}
}

/** GET-style handler: load the run and run the action. Pass `sameOrigin` to also guard a write. */
async function withRun(
	db: StageDb,
	runId: string | undefined,
	res: Res,
	action: (run: ChapterRunRow) => Promise<unknown>,
	opts: { sameOrigin?: Req } = {},
): Promise<void> {
	if (opts.sameOrigin && !enforceSameOrigin(opts.sameOrigin, res)) return;
	const run = loadRun(db, runId, res);
	if (!run) return;
	await respond(res, () => action(run));
}

/** POST-style handler: enforce same-origin, parse + validate the body, then run the action. */
async function withRunBody<T>(
	db: StageDb,
	req: Req,
	res: Res,
	runId: string | undefined,
	schema: z.ZodType<T>,
	action: (run: ChapterRunRow, body: T) => Promise<unknown>,
): Promise<void> {
	if (!enforceSameOrigin(req, res)) return;
	const run = loadRun(db, runId, res);
	if (!run) return;
	const body = await parseJsonBody(req, res, schema);
	if (body === null) return;
	await respond(res, () => action(run, body));
}
