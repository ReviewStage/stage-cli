import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { CommentThread, CreateCommentThreadBody } from "@stagereview/types/comments";
import { expect } from "vitest";
import { closeDb, getDb, type StageDb } from "../db/client.js";
import { commentRoutes } from "../routes/comments.js";
import { insertChaptersFile } from "../runs/import-chapters.js";
import type { ChaptersFile } from "../schema.js";
import { LOOPBACK_HOST, type ServerHandle, startServer } from "../server.js";
import { makeFixture, makeRepoContext } from "./fixtures.js";

export interface JsonResponse {
	status: number;
	body: unknown;
}

export class CommentRouteHarness {
	private tmpDir = "";
	private dbPath = "";
	private webDist = "";
	private readonly handles: ServerHandle[] = [];

	get db(): StageDb {
		return getDb({ dbPath: this.dbPath });
	}

	async setup(): Promise<void> {
		this.tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage-cli-comments-"));
		this.dbPath = path.join(this.tmpDir, "db.sqlite");
		this.webDist = path.join(this.tmpDir, "web-dist");
		await fs.mkdir(this.webDist);
		await fs.writeFile(path.join(this.webDist, "index.html"), "<html></html>");
		closeDb();
	}

	async teardown(): Promise<void> {
		while (this.handles.length > 0) {
			const handle = this.handles.pop();
			if (handle) await handle.close();
		}
		closeDb();
		await fs.rm(this.tmpDir, { recursive: true, force: true });
	}

	async start(): Promise<number> {
		const handle = await startServer({
			webDistPath: this.webDist,
			routes: commentRoutes(this.db, this.tmpDir),
		});
		this.handles.push(handle);
		return handle.port;
	}

	request(
		port: number,
		method: string,
		requestPath: string,
		body?: unknown,
		extraHeaders: Record<string, string> = {},
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
					res.on("data", (chunk: Buffer) => chunks.push(chunk));
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

	seedRun(overrides: Partial<ChaptersFile> = {}): string {
		return insertChaptersFile(this.db, makeFixture(overrides), makeRepoContext()).runId;
	}

	makeThreadBody(overrides: Partial<CreateCommentThreadBody> = {}): CreateCommentThreadBody {
		return {
			filePath: "src/foo.ts",
			side: "additions",
			startLine: 5,
			endLine: 10,
			body: "Why does this fall back to the primary org?",
			...overrides,
		};
	}

	async createThread(
		port: number,
		runId: string,
		overrides: Partial<CreateCommentThreadBody> = {},
	): Promise<CommentThread> {
		const response = await this.request(
			port,
			"POST",
			`/api/runs/${runId}/comment-threads`,
			this.makeThreadBody(overrides),
		);
		expect(response.status).toBe(201);
		return response.body as CommentThread;
	}
}
