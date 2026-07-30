import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { CommentThread, CreateCommentThreadBody } from "@stagereview/types/comments";
import { afterEach, beforeEach, expect } from "vitest";
import { closeDb, getDb } from "../db/client.js";
import { commentRoutes } from "../routes/comments.js";
import { insertChaptersFile } from "../runs/import-chapters.js";
import type { ChaptersFile } from "../schema.js";
import { LOOPBACK_HOST, type ServerHandle, startServer } from "../server.js";
import { makeFixture, makeRepoContext } from "./fixtures.js";

export interface JsonResponse {
	status: number;
	body: unknown;
}

// Fires a raw HTTP request at a running comment-routes server. Shared across every
// comments test file — the request/response plumbing never varies per test.
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
				res.on("end", () => {
					const text = Buffer.concat(chunks).toString("utf8");
					resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : null });
				});
			},
		);
		req.on("error", reject);
		if (payload) req.write(payload);
		req.end();
	});
}

export function makeThreadBody(
	over: Partial<CreateCommentThreadBody> = {},
): CreateCommentThreadBody {
	return {
		filePath: "src/foo.ts",
		side: "additions",
		startLine: 5,
		endLine: 10,
		body: "Why does this fall back to the primary org?",
		...over,
	};
}

export interface CommentRoutesTestEnv {
	/** Path of the current test's temp SQLite file. Live-updates every `beforeEach`. */
	readonly dbPath: string;
	startWithRoutes(): Promise<ServerHandle>;
	seedRun(over?: Partial<ChaptersFile>): string;
	createThread(
		port: number,
		runId: string,
		over?: Partial<CreateCommentThreadBody>,
	): Promise<CommentThread>;
}

// Registers the beforeEach/afterEach lifecycle every comment-routes test file needs
// (temp SQLite db, temp web-dist, server cleanup) and returns helpers bound to that
// per-test state. Vitest gives each test file its own module graph, so two test
// files calling this each get an independent temp dir and server-handle list —
// nothing leaks between comments.routes.test.ts and comments-pr.routes.test.ts.
export function setupCommentRoutesTest(tmpPrefix: string): CommentRoutesTestEnv {
	let tmpDir = "";
	let dbPath = "";
	let webDist = "";
	const handles: ServerHandle[] = [];

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), tmpPrefix));
		dbPath = path.join(tmpDir, "db.sqlite");
		webDist = path.join(tmpDir, "web-dist");
		await fs.mkdir(webDist);
		await fs.writeFile(path.join(webDist, "index.html"), "<html></html>");
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
		const handle = await startServer({ webDistPath: webDist, routes: commentRoutes(db) });
		handles.push(handle);
		return handle;
	}

	function seedRun(over: Partial<ChaptersFile> = {}): string {
		const db = getDb({ dbPath });
		return insertChaptersFile(db, makeFixture(over), makeRepoContext()).runId;
	}

	async function createThread(
		port: number,
		runId: string,
		over: Partial<CreateCommentThreadBody> = {},
	): Promise<CommentThread> {
		const res = await send(
			port,
			"POST",
			`/api/runs/${runId}/comment-threads`,
			makeThreadBody(over),
		);
		expect(res.status).toBe(201);
		return res.body as CommentThread;
	}

	return {
		get dbPath() {
			return dbPath;
		},
		startWithRoutes,
		seedRun,
		createThread,
	};
}
