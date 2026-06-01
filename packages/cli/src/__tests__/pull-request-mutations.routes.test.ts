import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../db/client.js";
import { chapterRun } from "../db/schema/index.js";
import { pullRequestMutationRoutes } from "../routes/pull-request-mutations.js";
import { SCOPE_KIND } from "../schema.js";
import { LOOPBACK_HOST, type ServerHandle, startServer } from "../server.js";

let tmpDir: string;
let dbPath: string;
let webDist: string;
let repoRoot: string;
let binDir: string;
let logFile: string;
let originalPath: string | undefined;
const handles: ServerHandle[] = [];

const SHA = "a".repeat(40);
const GITHUB_ORIGIN = "git@github.com:owner/repo.git";

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage-cli-pr-mut-"));
	dbPath = path.join(tmpDir, "db.sqlite");
	webDist = path.join(tmpDir, "web-dist");
	repoRoot = path.join(tmpDir, "repo");
	binDir = path.join(tmpDir, "bin");
	logFile = path.join(tmpDir, "gh-args.log");
	await fs.mkdir(webDist);
	await fs.writeFile(path.join(webDist, "index.html"), "<html></html>");
	await fs.mkdir(repoRoot);
	await fs.mkdir(binDir);
	// Fake gh that records its argv (one line per invocation) and succeeds.
	await fs.writeFile(path.join(binDir, "gh"), `#!/bin/sh\necho "$@" >> "${logFile}"\n`);
	await fs.chmod(path.join(binDir, "gh"), 0o755);
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

function insertRun(): string {
	const db = getDb({ dbPath });
	const [row] = db
		.insert(chapterRun)
		.values({
			repoRoot,
			originUrl: GITHUB_ORIGIN,
			scopeKind: SCOPE_KIND.COMMITTED,
			workingTreeRef: null,
			baseSha: SHA,
			headSha: SHA,
			mergeBaseSha: SHA,
			generatedAt: new Date(),
		})
		.returning({ id: chapterRun.id })
		.all();
	if (!row) throw new Error("seed: chapter_run insert returned no row");
	return row.id;
}

async function start(): Promise<number> {
	const db = getDb({ dbPath });
	const handle = await startServer({ webDistPath: webDist, routes: pullRequestMutationRoutes(db) });
	handles.push(handle);
	return handle.port;
}

function send(
	port: number,
	method: string,
	p: string,
	body: unknown,
): Promise<{ status: number; body: string }> {
	return new Promise((resolve, reject) => {
		const payload = JSON.stringify(body);
		const req = http.request(
			{
				hostname: LOOPBACK_HOST,
				port,
				method,
				path: p,
				agent: false,
				headers: {
					"Content-Type": "application/json",
					"Content-Length": Buffer.byteLength(payload),
				},
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (c: Buffer) => chunks.push(c));
				res.on("end", () =>
					resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
				);
			},
		);
		req.on("error", reject);
		req.end(payload);
	});
}

async function ghArgs(): Promise<string[]> {
	try {
		return (await fs.readFile(logFile, "utf8")).trim().split("\n").filter(Boolean);
	} catch {
		return [];
	}
}

describe("pull-request mutation API", () => {
	it("invokes `gh pr edit --title` for a title change", async () => {
		const runId = insertRun();
		const res = await send(await start(), "PATCH", `/api/runs/${runId}/pull-request/title`, {
			number: 7,
			title: "New title",
		});
		expect(res.status).toBe(200);
		expect(await ghArgs()).toEqual(["pr edit 7 --title New title"]);
	});

	it("invokes `gh pr merge --squash --match-head-commit` for a squash merge", async () => {
		const runId = insertRun();
		const res = await send(await start(), "POST", `/api/runs/${runId}/pull-request/merge`, {
			number: 7,
			mergeMethod: "SQUASH",
			expectedHeadOid: SHA,
		});
		expect(res.status).toBe(200);
		expect(await ghArgs()).toEqual([`pr merge 7 --squash --match-head-commit ${SHA}`]);
	});

	it("maps auto-merge enable/disable onto gh's --auto/--disable-auto", async () => {
		const runId = insertRun();
		const port = await start();
		await send(port, "POST", `/api/runs/${runId}/pull-request/auto-merge`, {
			number: 7,
			enabled: true,
			mergeMethod: "MERGE",
		});
		await send(port, "POST", `/api/runs/${runId}/pull-request/auto-merge`, {
			number: 7,
			enabled: false,
		});
		expect(await ghArgs()).toEqual(["pr merge 7 --auto --merge", "pr merge 7 --disable-auto"]);
	});

	it("forwards expectedHeadOid to gh as --match-head-commit when enabling auto-merge", async () => {
		const runId = insertRun();
		const res = await send(await start(), "POST", `/api/runs/${runId}/pull-request/auto-merge`, {
			number: 7,
			enabled: true,
			mergeMethod: "SQUASH",
			expectedHeadOid: SHA,
		});
		expect(res.status).toBe(200);
		expect(await ghArgs()).toEqual([`pr merge 7 --auto --squash --match-head-commit ${SHA}`]);
	});

	it("adds and removes reviewers via gh pr edit", async () => {
		const runId = insertRun();
		const port = await start();
		await send(port, "POST", `/api/runs/${runId}/pull-request/reviewers`, {
			number: 7,
			reviewers: ["alice", "bob"],
		});
		await send(port, "DELETE", `/api/runs/${runId}/pull-request/reviewers`, {
			number: 7,
			reviewers: ["bob"],
		});
		expect(await ghArgs()).toEqual([
			"pr edit 7 --add-reviewer alice,bob",
			"pr edit 7 --remove-reviewer bob",
		]);
	});

	it("rejects an invalid body", async () => {
		const runId = insertRun();
		const res = await send(await start(), "POST", `/api/runs/${runId}/pull-request/draft`, {
			number: -1,
		});
		expect(res.status).toBe(400);
	});
});
