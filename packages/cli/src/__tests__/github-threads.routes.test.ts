import fs from "node:fs/promises";
import path from "node:path";
import { GitHubThreadsResponseSchema } from "@stagereview/types/github-threads";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../db/client.js";
import { chapterRun } from "../db/schema/index.js";
import { gitHubThreadRoutes } from "../routes/github-threads.js";
import { insertChaptersFile } from "../runs/import-chapters.js";
import { makeFixture, makeRepoContext } from "./fixtures.js";
import { request, setupGhRouteTest } from "./gh-route-harness.js";

const env = setupGhRouteTest("stage-cli-github-threads-");

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

/**
 * Fake `gh` where every `api graphql` call logs its invocation then prints
 * `output`, or exits 1 when omitted. The log lets tests assert `gh` was never
 * invoked at all (e.g. when the route short-circuits on a non-GitHub remote).
 */
function fakeGhScript(binDir: string, output?: string): string {
	const log = `echo invoked >> "${binDir}/gh-invoked.log"\n`;
	return output === undefined
		? `#!/bin/sh\n${log}exit 1\n`
		: `#!/bin/sh\n${log}cat <<'EOF'\n${output}\nEOF\n`;
}

async function ghWasInvoked(binDir: string): Promise<boolean> {
	return fs
		.access(path.join(binDir, "gh-invoked.log"))
		.then(() => true)
		.catch(() => false);
}

/** Seed a run with `insertChaptersFile`, optionally stamping a `prNumber` afterward. */
function seedRun(originUrl: string, prNumber: number | null): string {
	const db = getDb({ dbPath: env.dbPath });
	const { runId } = insertChaptersFile(
		db,
		makeFixture(),
		makeRepoContext({ root: env.repoRoot, originUrl }),
	);
	if (prNumber !== null) {
		db.update(chapterRun).set({ prNumber }).where(eq(chapterRun.id, runId)).run();
	}
	return runId;
}

function start(): Promise<number> {
	const db = getDb({ dbPath: env.dbPath });
	return env.startWithRoutes(gitHubThreadRoutes(db));
}

const GITHUB_ORIGIN = "git@github.com:owner/repo.git";

describe("GET /api/runs/:runId/github-threads", () => {
	it("returns mapped review threads for a PR run", async () => {
		await env.writeFakeGh(fakeGhScript(env.binDir, THREADS_JSON));
		const runId = seedRun(GITHUB_ORIGIN, 7);
		const res = await request(await start(), `/api/runs/${runId}/github-threads`);
		expect(res.status).toBe(200);
		const body = GitHubThreadsResponseSchema.parse(JSON.parse(res.body));
		expect(body.available).toBe(true);
		expect(body.threads).toHaveLength(1);
		expect(body.threads[0]?.anchor).toEqual({ side: "additions", startLine: 10, endLine: 10 });
	});

	it("reports unavailable with no threads when the run has no PR", async () => {
		const runId = seedRun(GITHUB_ORIGIN, null);
		const res = await request(await start(), `/api/runs/${runId}/github-threads`);
		expect(res.status).toBe(200);
		const body = GitHubThreadsResponseSchema.parse(JSON.parse(res.body));
		expect(body).toEqual({ available: false, threads: [] });
	});

	it("reports unavailable for a non-GitHub remote without invoking gh", async () => {
		await env.writeFakeGh(fakeGhScript(env.binDir, THREADS_JSON));
		const runId = seedRun("git@gitlab.com:owner/repo.git", 7);
		const res = await request(await start(), `/api/runs/${runId}/github-threads`);
		expect(res.status).toBe(200);
		const body = GitHubThreadsResponseSchema.parse(JSON.parse(res.body));
		expect(body).toEqual({ available: false, threads: [] });
		expect(await ghWasInvoked(env.binDir)).toBe(false);
	});

	it("reports unavailable when gh fails", async () => {
		await env.writeFakeGh(fakeGhScript(env.binDir));
		const runId = seedRun(GITHUB_ORIGIN, 7);
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
