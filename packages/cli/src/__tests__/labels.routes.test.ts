import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../db/client.js";
import { chapterRun } from "../db/schema/index.js";
import { labelRoutes } from "../routes/labels.js";
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

const REPO_LABELS_PAGES = [
	[
		{ id: 1, name: "bug", color: "d73a4a", description: "Something isn't working" },
		{ id: 2, name: "enhancement", color: "a2eeef", description: null },
	],
	[{ id: 3, name: "help wanted", color: "008672", description: "Extra attention is needed" }],
];

const PR_LABELS_PAGES = [[{ id: 1, name: "bug", color: "d73a4a", description: null }]];

interface GhShimOptions {
	failListLabels?: boolean;
}

async function writeGhShim(options: GhShimOptions = {}): Promise<void> {
	const shim = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const stdin = args.includes("--input") ? fs.readFileSync(0, "utf8") : "";
fs.appendFileSync(${JSON.stringify(logFile)}, JSON.stringify({ args, stdin }) + "\\n");
const endpoint = args.find((arg) => arg.startsWith("repos/")) ?? "";
if (args.includes("--method")) {
  process.stdout.write("[]");
} else if (${options.failListLabels ? "true" : "false"}) {
  process.stderr.write("gh: HTTP 502 from GitHub\\n");
  process.exit(1);
} else if (endpoint.includes("/issues/")) {
  process.stdout.write(JSON.stringify(${JSON.stringify(PR_LABELS_PAGES)}));
} else {
  process.stdout.write(JSON.stringify(${JSON.stringify(REPO_LABELS_PAGES)}));
}
`;
	await fs.writeFile(path.join(binDir, "gh"), shim);
	await fs.chmod(path.join(binDir, "gh"), 0o755);
}

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage-cli-labels-"));
	dbPath = path.join(tmpDir, "db.sqlite");
	webDist = path.join(tmpDir, "web-dist");
	repoRoot = path.join(tmpDir, "repo");
	binDir = path.join(tmpDir, "bin");
	logFile = path.join(tmpDir, "gh-calls.log");
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

function insertRun(originUrl: string | null = GITHUB_ORIGIN): string {
	const db = getDb({ dbPath });
	const [row] = db
		.insert(chapterRun)
		.values({
			repoRoot,
			originUrl,
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
	const handle = await startServer({ webDistPath: webDist, routes: labelRoutes(db) });
	handles.push(handle);
	return handle.port;
}

function send(
	port: number,
	method: string,
	p: string,
	body?: unknown,
	extraHeaders: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
	return new Promise((resolve, reject) => {
		const payload = body === undefined ? undefined : JSON.stringify(body);
		const req = http.request(
			{
				hostname: LOOPBACK_HOST,
				port,
				method,
				path: p,
				agent: false,
				headers:
					payload === undefined
						? extraHeaders
						: {
								...extraHeaders,
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

async function ghCalls(): Promise<{ args: string[]; stdin: string }[]> {
	try {
		const text = await fs.readFile(logFile, "utf8");
		return text
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as { args: string[]; stdin: string });
	} catch {
		return [];
	}
}

describe("label API", () => {
	it("returns the PR's current labels via the issue-labels endpoint", async () => {
		await writeGhShim();
		const runId = insertRun();

		const res = await send(await start(), "GET", `/api/runs/${runId}/pull-request/labels?number=7`);

		expect(res.status).toBe(200);
		expect(JSON.parse(res.body)).toEqual({
			labels: [{ id: 1, name: "bug", color: "d73a4a", description: null }],
		});
		const calls = await ghCalls();
		expect(calls[0]?.args).toEqual([
			"api",
			"repos/owner/repo/issues/7/labels",
			"--paginate",
			"--slurp",
		]);
	});

	it("degrades current labels to null when gh fails", async () => {
		await writeGhShim({ failListLabels: true });
		const runId = insertRun();

		const res = await send(await start(), "GET", `/api/runs/${runId}/pull-request/labels?number=7`);

		expect(res.status).toBe(200);
		expect(JSON.parse(res.body)).toEqual({ labels: null });
	});

	it("rejects a current-labels read without a PR number", async () => {
		await writeGhShim();
		const runId = insertRun();

		const res = await send(await start(), "GET", `/api/runs/${runId}/pull-request/labels`);

		expect(res.status).toBe(400);
	});

	it("lists repository labels across pages", async () => {
		await writeGhShim();
		const runId = insertRun();

		const res = await send(
			await start(),
			"GET",
			`/api/runs/${runId}/pull-request/labels/repository`,
		);

		expect(res.status).toBe(200);
		expect(JSON.parse(res.body).labels.map((l: { name: string }) => l.name)).toEqual([
			"bug",
			"enhancement",
			"help wanted",
		]);
		const calls = await ghCalls();
		expect(calls[0]?.args).toEqual(["api", "repos/owner/repo/labels", "--paginate", "--slurp"]);
	});

	it("surfaces a repository label listing failure as a 500", async () => {
		await writeGhShim({ failListLabels: true });
		const runId = insertRun();

		const res = await send(
			await start(),
			"GET",
			`/api/runs/${runId}/pull-request/labels/repository`,
		);

		expect(res.status).toBe(500);
		expect(JSON.parse(res.body).error).toMatch(/502/);
	});

	it("adds labels through the issue-labels endpoint with a JSON body on stdin", async () => {
		await writeGhShim();
		const runId = insertRun();

		const res = await send(await start(), "POST", `/api/runs/${runId}/pull-request/labels`, {
			number: 7,
			labels: ["bug", "help wanted"],
		});

		expect(res.status).toBe(200);
		const calls = await ghCalls();
		expect(calls[0]?.args).toEqual([
			"api",
			"--method",
			"POST",
			"repos/owner/repo/issues/7/labels",
			"--input",
			"-",
		]);
		expect(JSON.parse(calls[0]?.stdin ?? "")).toEqual({ labels: ["bug", "help wanted"] });
	});

	it("removes a label, URL-encoding its name in the endpoint path", async () => {
		await writeGhShim();
		const runId = insertRun();

		const res = await send(await start(), "DELETE", `/api/runs/${runId}/pull-request/labels`, {
			number: 7,
			label: "help wanted",
		});

		expect(res.status).toBe(200);
		const calls = await ghCalls();
		expect(calls[0]?.args).toEqual([
			"api",
			"--method",
			"DELETE",
			"repos/owner/repo/issues/7/labels/help%20wanted",
		]);
	});

	it("rejects a cross-origin label mutation without invoking gh", async () => {
		await writeGhShim();
		const runId = insertRun();

		const res = await send(
			await start(),
			"POST",
			`/api/runs/${runId}/pull-request/labels`,
			{ number: 7, labels: ["bug"] },
			{ Origin: "https://evil.example" },
		);

		expect(res.status).toBe(403);
		expect(await ghCalls()).toEqual([]);
	});

	it("rejects an empty labels array", async () => {
		await writeGhShim();
		const runId = insertRun();

		const res = await send(await start(), "POST", `/api/runs/${runId}/pull-request/labels`, {
			number: 7,
			labels: [],
		});

		expect(res.status).toBe(400);
		expect(await ghCalls()).toEqual([]);
	});

	it("returns 404 for a run without a GitHub remote", async () => {
		await writeGhShim();
		const runId = insertRun(null);

		const res = await send(
			await start(),
			"GET",
			`/api/runs/${runId}/pull-request/labels/repository`,
		);

		expect(res.status).toBe(404);
	});
});
