import path from "node:path";
import { eq } from "drizzle-orm";
import type { StageDb } from "../db/client.js";
import { chapterRun } from "../db/schema/index.js";
import { type GitHubRepo, parseGitHubRepo } from "../github/index.js";
import type { RouteHandler, RouteParams } from "../server.js";
import { writeJson } from "./json.js";

type Res = Parameters<RouteHandler>[1];
type Req = Parameters<RouteHandler>[0];

export interface RunRepo {
	repoRoot: string;
	originUrl: string | null;
}

/** Resolve a run's repo context, writing the matching error response on failure. */
export function resolveRun(db: StageDb, params: RouteParams, res: Res): RunRepo | null {
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

export function requireRepo(run: RunRepo, res: Res): GitHubRepo | null {
	const repo = parseGitHubRepo(run.originUrl);
	if (!repo) {
		writeJson(res, 404, { error: "Run is not associated with a GitHub remote" });
		return null;
	}
	return repo;
}

export function query(req: Req, key: string): string | null {
	const url = req.url ?? "";
	const qIdx = url.indexOf("?");
	if (qIdx < 0) return null;
	return new URLSearchParams(url.slice(qIdx + 1)).get(key);
}

export function parseNumber(value: string | null): number | null {
	if (value === null) return null;
	const n = Number(value);
	return Number.isInteger(n) && n > 0 ? n : null;
}
