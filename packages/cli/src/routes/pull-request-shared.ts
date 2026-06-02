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

/** The server only ever binds to loopback, so a legitimate `Host` is one of these. */
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost"]);

/** Hostname from a `Host` header (`host[:port]`), or null if it can't be parsed. */
function hostHeaderHostname(host: string | undefined): string | null {
	if (!host) return null;
	try {
		return new URL(`http://${host}`).hostname;
	} catch {
		return null;
	}
}

/**
 * Reject state-changing requests that could be CSRF or DNS-rebinding vectors
 * against the gh-backed mutations. The server binds to loopback, but a browser
 * on any site can POST to the predictable port and trigger a write.
 *
 * Two checks, both required:
 *
 * 1. **Loopback Host.** The server only binds to `127.0.0.1`, so a legitimate
 *    request always carries a loopback `Host`. This is the anti-DNS-rebinding
 *    guard: an attacker who rebinds their hostname to `127.0.0.1` reaches us
 *    with that hostname in *both* `Origin` and `Host` — defeating a bare
 *    `Origin === Host` check — but the hostname isn't a loopback literal, so we
 *    reject it here. `Host` is mandatory under HTTP/1.1, so this also rejects
 *    requests that omit it.
 * 2. **Same-origin.** Browsers always attach an accurate `Origin` on
 *    cross-origin requests and JS can't forge it, so when an `Origin` is present
 *    its host:port must match the `Host` connected to. This rejects remote sites
 *    and other local origins alike (e.g. a page on `http://localhost:3000`).
 *
 * Non-browser clients (curl, scripts) send no `Origin` and are allowed once the
 * Host check passes — they aren't a CSRF vector. Returns false (and writes 403)
 * when the request must be rejected.
 */
export function enforceSameOrigin(req: Req, res: Res): boolean {
	const host = req.headers.host;
	const hostname = hostHeaderHostname(host);
	if (hostname === null || !LOOPBACK_HOSTNAMES.has(hostname)) {
		writeJson(res, 403, { error: "Cross-origin request rejected" });
		return false;
	}
	const origin = req.headers.origin;
	if (origin === undefined) return true;
	try {
		if (new URL(origin).host === host) return true;
	} catch {
		// malformed Origin — fall through to reject
	}
	writeJson(res, 403, { error: "Cross-origin request rejected" });
	return false;
}
