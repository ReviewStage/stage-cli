import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getDb } from "../db/client.js";
import { commentThread } from "../db/schema/index.js";
import { send } from "./gh-route-harness.js";
import {
	createThread,
	env,
	FAILING_GH_SCRIPT,
	SUCCESS_GH_SCRIPT,
	startWithRoutes,
} from "./github-review-submit-harness.js";

describe("POST /api/runs/:runId/review", () => {
	it("submits pending threads as one review and deletes them locally", async () => {
		await env.writeFakeGh(SUCCESS_GH_SCRIPT);
		const runId = env.seedRun(7);
		const { port } = await startWithRoutes();
		await createThread(port, runId, { body: "pending A", startLine: 5, endLine: 5 });
		await createThread(port, runId, { body: "pending B", startLine: 6, endLine: 10 });

		const res = await send(port, "POST", `/api/runs/${runId}/review`, {
			event: "REQUEST_CHANGES",
			body: "Overall summary",
		});
		expect(res.status).toBe(200);

		const argsLog = await fs.readFile(path.join(env.binDir, "args.log"), "utf8");
		expect(argsLog).toContain("repos/owner/repo/pulls/7/reviews");
		const payload = JSON.parse(await fs.readFile(path.join(env.binDir, "stdin.log"), "utf8"));
		expect(payload.event).toBe("REQUEST_CHANGES");
		expect(payload.comments).toHaveLength(2);
		expect(payload.comments[1]).toMatchObject({
			path: "src/foo.ts",
			line: 10,
			side: "RIGHT",
			start_line: 6,
			start_side: "RIGHT",
		});

		const db = getDb({ dbPath: env.dbPath });
		expect(db.select().from(commentThread).all()).toHaveLength(0);
	});

	it("keeps pending threads when gh fails", async () => {
		await env.writeFakeGh(FAILING_GH_SCRIPT);
		const runId = env.seedRun(7);
		const { port } = await startWithRoutes();
		await createThread(port, runId, { body: "pending A" });

		const res = await send(port, "POST", `/api/runs/${runId}/review`, {
			event: "APPROVE",
			body: "",
		});
		expect(res.status).toBe(502);

		const db = getDb({ dbPath: env.dbPath });
		expect(db.select().from(commentThread).all()).toHaveLength(1);
	});

	it("leaves local notes (prNumber null) untouched by submit", async () => {
		await env.writeFakeGh(SUCCESS_GH_SCRIPT);
		const prRunId = env.seedRun(7);
		const plainRunId = env.seedRun(null);
		const { port } = await startWithRoutes();
		await createThread(port, prRunId, { body: "pending" });
		await createThread(port, plainRunId, { body: "note" });

		await send(port, "POST", `/api/runs/${prRunId}/review`, { event: "COMMENT", body: "x" });

		const db = getDb({ dbPath: env.dbPath });
		const rows = db.select().from(commentThread).all();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.prNumber).toBeNull();
	});

	it("submits successfully with zero pending threads", async () => {
		await env.writeFakeGh(SUCCESS_GH_SCRIPT);
		const runId = env.seedRun(7);
		const { port } = await startWithRoutes();

		const res = await send(port, "POST", `/api/runs/${runId}/review`, {
			event: "APPROVE",
			body: "LGTM",
		});
		expect(res.status).toBe(200);

		const payload = JSON.parse(await fs.readFile(path.join(env.binDir, "stdin.log"), "utf8"));
		expect(payload.comments).toEqual([]);
	});

	it("rejects a cross-origin submit with 403 before any mutation", async () => {
		await env.writeFakeGh(SUCCESS_GH_SCRIPT);
		const { port } = await startWithRoutes();
		const res = await send(
			port,
			"POST",
			"/api/runs/any/review",
			{ event: "COMMENT", body: "x" },
			{ Origin: "http://evil.example" },
		);
		expect(res.status).toBe(403);
	});

	it("returns 404 for an unknown run", async () => {
		await env.writeFakeGh(SUCCESS_GH_SCRIPT);
		const { port } = await startWithRoutes();
		const res = await send(port, "POST", "/api/runs/missing/review", {
			event: "COMMENT",
			body: "x",
		});
		expect(res.status).toBe(404);
	});
});
