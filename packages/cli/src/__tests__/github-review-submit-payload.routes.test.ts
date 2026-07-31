import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getDb } from "../db/client.js";
import { commentThread } from "../db/schema/index.js";
import { send } from "./gh-route-harness.js";
import {
	createThread,
	env,
	SUCCESS_GH_SCRIPT,
	startWithRoutes,
} from "./github-review-submit-harness.js";

describe("POST /api/runs/:runId/review — payload construction and validation", () => {
	it("maps a deletions-side thread to the LEFT side", async () => {
		await env.writeFakeGh(SUCCESS_GH_SCRIPT);
		const runId = env.seedRun(7);
		const { port } = await startWithRoutes();
		await createThread(port, runId, { side: "deletions", startLine: 3, endLine: 3 });

		await send(port, "POST", `/api/runs/${runId}/review`, { event: "COMMENT", body: "x" });

		const payload = JSON.parse(await fs.readFile(path.join(env.binDir, "stdin.log"), "utf8"));
		expect(payload.comments[0]).toMatchObject({ side: "LEFT" });
		expect(payload.comments[0].start_side).toBeUndefined();
	});

	it("joins multiple comments on a thread with a separator", async () => {
		await env.writeFakeGh(SUCCESS_GH_SCRIPT);
		const runId = env.seedRun(7);
		const { port } = await startWithRoutes();
		const thread = await createThread(port, runId, { body: "first" });
		await send(port, "POST", `/api/comment-threads/${thread.id}/replies`, { body: "second" });

		await send(port, "POST", `/api/runs/${runId}/review`, { event: "COMMENT", body: "x" });

		const payload = JSON.parse(await fs.readFile(path.join(env.binDir, "stdin.log"), "utf8"));
		expect(payload.comments[0].body).toBe("first\n\n---\n\nsecond");
	});

	it("rejects a malformed body (missing or invalid event) with 400", async () => {
		await env.writeFakeGh(SUCCESS_GH_SCRIPT);
		const runId = env.seedRun(7);
		const { port } = await startWithRoutes();

		const missingEvent = await send(port, "POST", `/api/runs/${runId}/review`, { body: "x" });
		expect(missingEvent.status).toBe(400);

		const invalidEvent = await send(port, "POST", `/api/runs/${runId}/review`, {
			event: "NOT_A_REAL_EVENT",
			body: "x",
		});
		expect(invalidEvent.status).toBe(400);
	});

	it("does not submit or delete a thread the user resolved locally", async () => {
		await env.writeFakeGh(SUCCESS_GH_SCRIPT);
		const runId = env.seedRun(7);
		const { port } = await startWithRoutes();
		const thread = await createThread(port, runId, { body: "pending" });
		await send(port, "PATCH", `/api/comment-threads/${thread.id}`, { resolved: true });

		const res = await send(port, "POST", `/api/runs/${runId}/review`, {
			event: "COMMENT",
			body: "x",
		});
		expect(res.status).toBe(200);

		const payload = JSON.parse(await fs.readFile(path.join(env.binDir, "stdin.log"), "utf8"));
		expect(payload.comments).toEqual([]);
		const db = getDb({ dbPath: env.dbPath });
		expect(db.select().from(commentThread).all()).toHaveLength(1);
	});
});
