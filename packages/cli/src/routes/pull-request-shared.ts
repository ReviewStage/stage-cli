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

/**
 * Reject cross-origin state-changing requests (CSRF guard for the gh-backed
 * mutations). The server binds to loopback, but a browser on any site can POST
 * to the predictable port and trigger a write. Browsers always attach an
 * accurate `Origin` on cross-origin requests and JS can't forge it, so we
 * require the request to be same-origin: the `Origin`'s host:port must match
 * the `Host` it connected to. This rejects not just remote sites but other
 * local origins too (e.g. a page on `http://localhost:3000`). Non-browser
 * clients (curl, scripts) send no `Origin` and are allowed — they aren't a CSRF
 * vector. Returns false (and writes 403) when the request must be rejected.
 */
export function enforceSameOrigin(req: Req, res: Res): boolean {
	const origin = req.headers.origin;
	if (origin === undefined) return true;
	try {
		if (req.headers.host && new URL(origin).host === req.headers.host) return true;
	} catch {
		// malformed Origin — fall through to reject
	}
	writeJson(res, 403, { error: "Cross-origin request rejected" });
	return false;
}
