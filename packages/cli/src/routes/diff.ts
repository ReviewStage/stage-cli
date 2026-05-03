import { spawn } from "node:child_process";
import type { ServerResponse } from "node:http";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { StageDb } from "../db/client.js";
import { chapterRun } from "../db/schema/index.js";
import { SCOPE_KIND, WORKING_TREE_REF } from "../schema.js";
import type { Route } from "../server.js";
import { writeJson } from "./json.js";

type ChapterRunRow = typeof chapterRun.$inferSelect;

export function diffRoutes(db: StageDb): Route[] {
	return [
		{
			method: "GET",
			pattern: "/api/runs/:runId/diff.patch",
			handler: async (_req, res, params) => {
				const runId = params.runId;
				if (!runId) {
					writeJson(res, 400, { error: "Missing runId" });
					return;
				}

				const [run] = db.select().from(chapterRun).where(eq(chapterRun.id, runId)).limit(1).all();
				if (!run) {
					writeJson(res, 404, { error: `Run ${runId} not found` });
					return;
				}

				// Defense in depth: repoRoot was validated at ingest, but the diff endpoint is
				// a fresh boundary. Refuse non-absolute paths or any path containing `..`
				// segments so we can't be tricked into spawning git against a traversal.
				const repoRoot = run.repoRoot;
				if (!path.isAbsolute(repoRoot) || repoRoot.split(path.sep).includes("..")) {
					writeJson(res, 500, {
						error: "Run repoRoot is not an absolute path or contains traversal segments",
					});
					return;
				}

				const args = buildDiffArgs(run);
				const cacheControl =
					run.scopeKind === SCOPE_KIND.COMMITTED ? "private, max-age=300" : "no-store";

				await streamGitDiff(res, repoRoot, args, cacheControl);
			},
		},
	];
}

function buildDiffArgs(run: ChapterRunRow): string[] {
	if (run.scopeKind === SCOPE_KIND.COMMITTED) {
		// `..` (not `...`) — we want the literal diff between the two SHAs, not the
		// merge-base diff that `...` would produce.
		return ["diff", "--no-color", `${run.baseSha}..${run.headSha}`];
	}
	if (run.workingTreeRef === null) {
		throw new Error("workingTree run is missing workingTreeRef");
	}
	switch (run.workingTreeRef) {
		case WORKING_TREE_REF.UNSTAGED:
			return ["diff", "--no-color"];
		case WORKING_TREE_REF.STAGED:
			return ["diff", "--no-color", "--cached"];
		case WORKING_TREE_REF.WORK:
			return ["diff", "--no-color", "HEAD"];
	}
}

function streamGitDiff(
	res: ServerResponse,
	cwd: string,
	args: string[],
	cacheControl: string,
): Promise<void> {
	return new Promise((resolve) => {
		const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });

		let stderr = "";
		let settled = false;

		const settle = () => {
			if (settled) return;
			settled = true;
			resolve();
		};

		const writeSuccessHeaders = () => {
			if (res.headersSent) return;
			res.writeHead(200, {
				"Content-Type": "text/plain; charset=utf-8",
				"Cache-Control": cacheControl,
			});
		};

		// If the client disconnects before git finishes, kill the child so we don't leak
		// a long-running diff for a request nobody is reading.
		res.once("close", () => {
			if (!child.killed) child.kill("SIGTERM");
		});

		child.on("error", (err) => {
			if (!res.headersSent) {
				writeJson(res, 500, { error: `git failed: ${err.message}` });
			} else if (!res.writableEnded) {
				res.end();
			}
			settle();
		});

		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString("utf8");
		});

		child.stdout.on("data", (chunk: Buffer) => {
			writeSuccessHeaders();
			if (!res.write(chunk)) {
				child.stdout.pause();
				res.once("drain", () => child.stdout.resume());
			}
		});

		child.on("close", (code) => {
			if (settled) return;
			if (code === 0) {
				// Successful exit with no stdout (empty diff) still needs headers + end.
				writeSuccessHeaders();
				res.end();
			} else if (!res.headersSent) {
				const message = stderr.trim() || `git exited with code ${code}`;
				writeJson(res, 500, { error: message });
			} else {
				// Headers were already sent, so we can't change the status. Log and terminate
				// the response — the client will see a truncated patch.
				process.stderr.write(`git diff failed mid-stream (exit ${code}): ${stderr}`);
				if (!res.writableEnded) res.end();
			}
			settle();
		});
	});
}
