import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach } from "vitest";
import { closeDb, getDb } from "../db/client.js";
import { chapterRun } from "../db/schema/index.js";
import { insertChaptersFile } from "../runs/import-chapters.js";
import { LOOPBACK_HOST, type Route, type ServerHandle, startServer } from "../server.js";
import { makeFixture, makeRepoContext } from "./fixtures.js";

/** Origin used by every gh-backed route test that needs a real GitHub remote. */
export const GITHUB_ORIGIN = "git@github.com:owner/repo.git";

export interface JsonResponse {
	status: number;
	body: string;
}

// Fires a raw GET at a running route-harness server. Shared across every
// gh-backed route test file — the request plumbing never varies per test.
export function request(port: number, requestPath: string): Promise<JsonResponse> {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{ hostname: LOOPBACK_HOST, port, method: "GET", path: requestPath, agent: false },
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

/**
 * Fires a raw HTTP request with an optional JSON body at a running route-harness
 * server. Mirrors `send` in comment-routes-harness.ts — every gh-backed mutation
 * test file needs POST/PATCH with bodies and custom headers, not just GET.
 */
export function send(
	port: number,
	method: string,
	requestPath: string,
	body?: unknown,
	extraHeaders?: Record<string, string>,
): Promise<JsonResponse> {
	const payload = body === undefined ? "" : JSON.stringify(body);
	return new Promise((resolve, reject) => {
		const req = http.request(
			{
				hostname: LOOPBACK_HOST,
				port,
				method,
				path: requestPath,
				agent: false,
				headers: {
					"Content-Type": "application/json",
					"Content-Length": Buffer.byteLength(payload).toString(),
					...extraHeaders,
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
		if (payload) req.write(payload);
		req.end();
	});
}

export interface GhRouteTestEnv {
	/** Path of the current test's temp SQLite file. Live-updates every `beforeEach`. */
	readonly dbPath: string;
	/** Fake repo root passed as a run's `repoRoot` — a real directory `gh` can use as cwd. */
	readonly repoRoot: string;
	/** Directory prepended to `PATH`, holding the fake `gh` executable. */
	readonly binDir: string;
	/** Write `script` as an executable `gh` on `PATH`, replacing any prior fake. */
	writeFakeGh(script: string): Promise<void>;
	/** Start a server for these routes against the temp web-dist; closed in `afterEach`. */
	startWithRoutes(routes: Route[]): Promise<number>;
	/**
	 * Seed a run against a GitHub remote (`GITHUB_ORIGIN`, the fixture's repoRoot),
	 * optionally stamping `prNumber` afterward. `null` leaves the run without a PR.
	 */
	seedRun(prNumber: number | null): string;
}

// Registers the beforeEach/afterEach lifecycle every gh-backed route test file needs
// (temp SQLite db, temp web-dist, temp repo root, fake-`gh`-on-`PATH` wiring, server
// cleanup) and returns helpers bound to that per-test state. Vitest gives each test
// file its own module graph, so two test files calling this each get independent temp
// dirs, PATH values, and server-handle lists — nothing leaks between files.
export function setupGhRouteTest(tmpPrefix: string): GhRouteTestEnv {
	let tmpDir = "";
	let dbPath = "";
	let webDist = "";
	let repoRoot = "";
	let binDir = "";
	let originalPath: string | undefined;
	const handles: ServerHandle[] = [];

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), tmpPrefix));
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

	async function writeFakeGh(script: string): Promise<void> {
		const file = path.join(binDir, "gh");
		await fs.writeFile(file, script);
		await fs.chmod(file, 0o755);
	}

	async function startWithRoutes(routes: Route[]): Promise<number> {
		const handle = await startServer({ webDistPath: webDist, routes });
		handles.push(handle);
		return handle.port;
	}

	function seedRun(prNumber: number | null): string {
		const db = getDb({ dbPath });
		const { runId } = insertChaptersFile(
			db,
			makeFixture(),
			makeRepoContext({ root: repoRoot, originUrl: GITHUB_ORIGIN }),
		);
		if (prNumber !== null) {
			db.update(chapterRun).set({ prNumber }).where(eq(chapterRun.id, runId)).run();
		}
		return runId;
	}

	return {
		get dbPath() {
			return dbPath;
		},
		get repoRoot() {
			return repoRoot;
		},
		get binDir() {
			return binDir;
		},
		writeFakeGh,
		startWithRoutes,
		seedRun,
	};
}
