import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../db/client.js";
import { chapterRun } from "../db/schema/index.js";
import { diffRoutes } from "../routes/diff.js";
import { SCOPE_KIND, WORKING_TREE_REF } from "../schema.js";
import { LOOPBACK_HOST, type ServerHandle, startServer } from "../server.js";

let tmpDir: string;
let dbPath: string;
let webDist: string;
let repoRoot: string;
const handles: ServerHandle[] = [];

const ZERO_SHA = "0".repeat(40);

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage-cli-diff-routes-"));
	dbPath = path.join(tmpDir, "db.sqlite");
	webDist = path.join(tmpDir, "web-dist");
	repoRoot = path.join(tmpDir, "repo");
	await fs.mkdir(webDist);
	await fs.writeFile(path.join(webDist, "index.html"), "<html></html>");
	await fs.mkdir(repoRoot);
	closeDb();
});

afterEach(async () => {
	while (handles.length > 0) {
		const h = handles.pop();
		if (h) await h.close();
	}
	closeDb();
	await fs.rm(tmpDir, { recursive: true, force: true });
});

async function startWithRoutes(): Promise<ServerHandle> {
	const db = getDb({ dbPath });
	const handle = await startServer({ webDistPath: webDist, routes: diffRoutes(db) });
	handles.push(handle);
	return handle;
}

function git(...args: string[]): string {
	return execFileSync("git", args, {
		cwd: repoRoot,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
	});
}

async function initRepoWithTwoCommits(): Promise<{ baseSha: string; headSha: string }> {
	git("init", "--initial-branch=main");
	git("config", "user.email", "test@example.com");
	git("config", "user.name", "Test");
	git("config", "commit.gpgsign", "false");

	await fs.writeFile(path.join(repoRoot, "file.txt"), "hello\n");
	git("add", "file.txt");
	git("commit", "-m", "first");
	const baseSha = git("rev-parse", "HEAD").trim();

	await fs.writeFile(path.join(repoRoot, "file.txt"), "hello\nworld\n");
	git("commit", "-am", "second");
	const headSha = git("rev-parse", "HEAD").trim();

	return { baseSha, headSha };
}

function insertCommittedRun(baseSha: string, headSha: string): string {
	const db = getDb({ dbPath });
	const [row] = db
		.insert(chapterRun)
		.values({
			repoRoot,
			scopeKind: SCOPE_KIND.COMMITTED,
			workingTreeRef: null,
			baseSha,
			headSha,
			mergeBaseSha: baseSha,
			generatedAt: new Date(),
		})
		.returning({ id: chapterRun.id })
		.all();
	if (!row) throw new Error("seed: chapter_run insert returned no row");
	return row.id;
}

function insertWorkingTreeRun(
	ref: (typeof WORKING_TREE_REF)[keyof typeof WORKING_TREE_REF],
): string {
	const headSha = git("rev-parse", "HEAD").trim();
	const db = getDb({ dbPath });
	const [row] = db
		.insert(chapterRun)
		.values({
			repoRoot,
			scopeKind: SCOPE_KIND.WORKING_TREE,
			workingTreeRef: ref,
			baseSha: headSha,
			headSha,
			mergeBaseSha: headSha,
			generatedAt: new Date(),
		})
		.returning({ id: chapterRun.id })
		.all();
	if (!row) throw new Error("seed: chapter_run insert returned no row");
	return row.id;
}

interface RawResponse {
	status: number;
	headers: http.IncomingHttpHeaders;
	body: string;
}

function rawRequest(port: number, requestPath: string): Promise<RawResponse> {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{ hostname: LOOPBACK_HOST, port, method: "GET", path: requestPath, agent: false },
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (c: Buffer) => chunks.push(c));
				res.on("end", () =>
					resolve({
						status: res.statusCode ?? 0,
						headers: res.headers,
						body: Buffer.concat(chunks).toString("utf8"),
					}),
				);
			},
		);
		req.on("error", reject);
		req.end();
	});
}

describe("diff API", () => {
	it("GET /api/runs/:runId/diff.patch streams the committed-scope unified diff", async () => {
		const { baseSha, headSha } = await initRepoWithTwoCommits();
		const runId = insertCommittedRun(baseSha, headSha);

		const { port } = await startWithRoutes();
		const res = await rawRequest(port, `/api/runs/${runId}/diff.patch`);

		expect(res.status).toBe(200);
		expect(res.headers["content-type"]).toMatch(/text\/plain/);
		expect(res.headers["cache-control"]).toBe("private, max-age=300");
		expect(res.body).toContain("diff --git a/file.txt b/file.txt");
		expect(res.body).toContain("+world");
		// --no-color should suppress ANSI escapes (literal ESC character).
		expect(res.body).not.toContain(`${String.fromCharCode(27)}[`);
	});

	it("returns the unstaged diff for workingTree/unstaged runs", async () => {
		await initRepoWithTwoCommits();
		await fs.writeFile(path.join(repoRoot, "file.txt"), "hello\nworld\nunstaged\n");
		const runId = insertWorkingTreeRun(WORKING_TREE_REF.UNSTAGED);

		const { port } = await startWithRoutes();
		const res = await rawRequest(port, `/api/runs/${runId}/diff.patch`);

		expect(res.status).toBe(200);
		expect(res.headers["cache-control"]).toBe("no-store");
		expect(res.body).toContain("+unstaged");
	});

	it("returns the staged diff for workingTree/staged runs", async () => {
		await initRepoWithTwoCommits();
		await fs.writeFile(path.join(repoRoot, "file.txt"), "hello\nworld\nstaged\n");
		git("add", "file.txt");
		// Add an extra unstaged change that must NOT appear in the staged diff.
		await fs.writeFile(path.join(repoRoot, "file.txt"), "hello\nworld\nstaged\nleak\n");
		const runId = insertWorkingTreeRun(WORKING_TREE_REF.STAGED);

		const { port } = await startWithRoutes();
		const res = await rawRequest(port, `/api/runs/${runId}/diff.patch`);

		expect(res.status).toBe(200);
		expect(res.headers["cache-control"]).toBe("no-store");
		expect(res.body).toContain("+staged");
		expect(res.body).not.toContain("+leak");
	});

	it("returns the combined diff vs HEAD for workingTree/work runs", async () => {
		await initRepoWithTwoCommits();
		// staged change
		await fs.writeFile(path.join(repoRoot, "file.txt"), "hello\nworld\nstaged\n");
		git("add", "file.txt");
		// plus an unstaged change on top
		await fs.writeFile(path.join(repoRoot, "file.txt"), "hello\nworld\nstaged\nunstaged\n");
		const runId = insertWorkingTreeRun(WORKING_TREE_REF.WORK);

		const { port } = await startWithRoutes();
		const res = await rawRequest(port, `/api/runs/${runId}/diff.patch`);

		expect(res.status).toBe(200);
		// `git diff HEAD` includes both staged and unstaged changes.
		expect(res.body).toContain("+staged");
		expect(res.body).toContain("+unstaged");
	});

	it("returns 404 for unknown runId", async () => {
		const { port } = await startWithRoutes();
		const res = await rawRequest(port, "/api/runs/00000000-0000-0000-0000-000000000000/diff.patch");
		expect(res.status).toBe(404);
		expect(JSON.parse(res.body)).toMatchObject({ error: expect.stringMatching(/not found/i) });
	});

	it("returns 500 with the underlying error when repoRoot has been removed", async () => {
		const { baseSha, headSha } = await initRepoWithTwoCommits();
		const runId = insertCommittedRun(baseSha, headSha);
		await fs.rm(repoRoot, { recursive: true, force: true });

		const { port } = await startWithRoutes();
		const res = await rawRequest(port, `/api/runs/${runId}/diff.patch`);

		expect(res.status).toBe(500);
		const body = JSON.parse(res.body) as { error: string };
		expect(body.error.toLowerCase()).toMatch(/enoent|no such file|not a git repository/);
	});

	it("returns 500 when the requested SHA is not reachable", async () => {
		const { baseSha } = await initRepoWithTwoCommits();
		const runId = insertCommittedRun(baseSha, ZERO_SHA);

		const { port } = await startWithRoutes();
		const res = await rawRequest(port, `/api/runs/${runId}/diff.patch`);

		expect(res.status).toBe(500);
		const body = JSON.parse(res.body) as { error: string };
		expect(body.error.toLowerCase()).toMatch(/bad object|unknown revision|fatal/);
	});
});
