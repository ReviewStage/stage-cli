import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { GitHubThreadsResponseSchema } from "@stagereview/types/github-threads";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../db/client.js";
import { chapterRun } from "../db/schema/index.js";
import { gitHubThreadRoutes } from "../routes/github-threads.js";
import { insertChaptersFile } from "../runs/import-chapters.js";
import { LOOPBACK_HOST, type ServerHandle, startServer } from "../server.js";
import { makeFixture, makeRepoContext } from "./fixtures.js";

let tmpDir: string;
let dbPath: string;
let webDist: string;
let repoRoot: string;
let binDir: string;
let originalPath: string | undefined;
const handles: ServerHandle[] = [];

// One page of review threads for a PR whose head matches the fixture's head SHA.
const THREADS_JSON = JSON.stringify({
	data: {
		repository: {
			pullRequest: {
				headRefOid: "2222222222222222222222222222222222222222",
				reviewThreads: {
					pageInfo: { hasNextPage: false, endCursor: null },
					nodes: [
						{
							id: "RT_1",
							isResolved: false,
							isOutdated: false,
							path: "src/foo.ts",
							line: 10,
							startLine: null,
							diffSide: "RIGHT",
							startDiffSide: null,
							comments: {
								nodes: [
									{
										fullDatabaseId: "111",
										body: "hm",
										url: "https://x",
										createdAt: "2026-07-01T00:00:00Z",
										viewerDidAuthor: false,
										author: { login: "octocat", avatarUrl: null, name: null },
									},
								],
							},
						},
					],
				},
			},
		},
	},
});

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage-cli-github-threads-"));
	dbPath = path.join(tmpDir, "db.sqlite");
	webDist = path.join(tmpDir, "web-dist");
	repoRoot = path.join(tmpDir, "repo");
	binDir = path.join(tmpDir, "bin");
	await fs.mkdir(webDist);
	await fs.writeFile(path.join(webDist, "index.html"), "<html></html>");
	await fs.mkdir(repoRoot);
	await fs.mkdir(binDir);
	originalPath = process.env.PATH;
	process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ""}`;
	closeDb();
});

afterEach(async () => {
	while (handles.length > 0) {
		const h = handles.pop();
		if (h) await h.close();
	}
	closeDb();
	process.env.PATH = originalPath;
	await fs.rm(tmpDir, { recursive: true, force: true });
});

/** Fake `gh` where every `api graphql` call prints `output`, or exits 1 when omitted. */
async function writeFakeGh(output?: string): Promise<void> {
	const script =
		output === undefined ? `#!/bin/sh\nexit 1\n` : `#!/bin/sh\ncat <<'EOF'\n${output}\nEOF\n`;
	const file = path.join(binDir, "gh");
	await fs.writeFile(file, script);
	await fs.chmod(file, 0o755);
}

/** Seed a run with `insertChaptersFile`, optionally stamping a `prNumber` afterward. */
function seedRun(prNumber: number | null): string {
	const db = getDb({ dbPath });
	const { runId } = insertChaptersFile(
		db,
		makeFixture(),
		makeRepoContext({ root: repoRoot, originUrl: "git@github.com:owner/repo.git" }),
	);
	if (prNumber !== null) {
		db.update(chapterRun).set({ prNumber }).where(eq(chapterRun.id, runId)).run();
	}
	return runId;
}

async function start(): Promise<number> {
	const db = getDb({ dbPath });
	const handle = await startServer({ webDistPath: webDist, routes: gitHubThreadRoutes(db) });
	handles.push(handle);
	return handle.port;
}

function request(port: number, p: string): Promise<{ status: number; body: string }> {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{ hostname: LOOPBACK_HOST, port, method: "GET", path: p, agent: false },
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (c: Buffer) => chunks.push(c));
				res.on("end", () =>
					resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
				);
			},
		);
		req.on("error", reject);
		req.end();
	});
}

describe("GET /api/runs/:runId/github-threads", () => {
	it("returns mapped review threads for a PR run", async () => {
		await writeFakeGh(THREADS_JSON);
		const runId = seedRun(7);
		const res = await request(await start(), `/api/runs/${runId}/github-threads`);
		expect(res.status).toBe(200);
		const body = GitHubThreadsResponseSchema.parse(JSON.parse(res.body));
		expect(body.available).toBe(true);
		expect(body.threads).toHaveLength(1);
		expect(body.threads[0]?.anchor).toEqual({ side: "additions", startLine: 10, endLine: 10 });
	});

	it("reports unavailable with no threads when the run has no PR", async () => {
		const runId = seedRun(null);
		const res = await request(await start(), `/api/runs/${runId}/github-threads`);
		expect(res.status).toBe(200);
		const body = GitHubThreadsResponseSchema.parse(JSON.parse(res.body));
		expect(body).toEqual({ available: false, threads: [] });
	});

	it("reports unavailable when gh fails", async () => {
		await writeFakeGh();
		const runId = seedRun(7);
		const res = await request(await start(), `/api/runs/${runId}/github-threads`);
		expect(res.status).toBe(200);
		const body = GitHubThreadsResponseSchema.parse(JSON.parse(res.body));
		expect(body).toEqual({ available: false, threads: [] });
	});

	it("returns 404 for an unknown runId", async () => {
		const res = await request(
			await start(),
			"/api/runs/00000000-0000-0000-0000-000000000000/github-threads",
		);
		expect(res.status).toBe(404);
	});
});
