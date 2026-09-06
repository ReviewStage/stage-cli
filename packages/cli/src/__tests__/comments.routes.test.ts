import type { CommentThread } from "@stagereview/types/comments";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { comment, commentThread } from "../db/schema/index.js";
import { CommentRouteHarness } from "./comments-route-harness.js";

let harness: CommentRouteHarness;

beforeEach(async () => {
	harness = new CommentRouteHarness();
	await harness.setup();
});

afterEach(async () => {
	await harness.teardown();
});

describe("comment threads API — reads and updates", () => {
	it("rejects a cross-origin write with 403 before any mutation", async () => {
		const port = await harness.start();
		const response = await harness.request(
			port,
			"POST",
			"/api/runs/any/comment-threads",
			harness.makeThreadBody(),
			{ Origin: "http://evil.example" },
		);
		expect(response.status).toBe(403);
	});

	it("rejects a cross-origin read of local comment bodies", async () => {
		const runId = harness.seedRun();
		const port = await harness.start();
		await harness.createThread(port, runId);

		const response = await harness.request(
			port,
			"GET",
			`/api/runs/${runId}/comment-threads`,
			undefined,
			{ Origin: "http://evil.example" },
		);

		expect(response.status).toBe(403);
		expect(response.body).toEqual({ error: "Cross-origin request rejected" });
	});

	it("creates a thread with its root comment and anchor", async () => {
		const runId = harness.seedRun();
		const port = await harness.start();

		const thread = await harness.createThread(port, runId, { body: "First!" });
		expect(thread).toMatchObject({
			filePath: "src/foo.ts",
			side: "additions",
			startLine: 5,
			endLine: 10,
			resolvedAt: null,
		});
		expect(thread.comments).toHaveLength(1);
		expect(thread.comments[0]).toMatchObject({
			body: "First!",
			authorId: "local",
			authorType: "user",
		});
		expect(harness.db.select().from(commentThread).all()).toHaveLength(1);
		expect(harness.db.select().from(comment).all()).toHaveLength(1);
	});

	it("lists threads with oldest comments first", async () => {
		const runId = harness.seedRun();
		const port = await harness.start();
		expect((await harness.request(port, "GET", `/api/runs/${runId}/comment-threads`)).body).toEqual(
			[],
		);

		const thread = await harness.createThread(port, runId);
		const reply = await harness.request(port, "POST", `/api/comment-threads/${thread.id}/replies`, {
			body: "A reply",
		});
		expect(reply.body).toMatchObject({ authorType: "user" });

		const response = await harness.request(port, "GET", `/api/runs/${runId}/comment-threads`);
		const threads = response.body as CommentThread[];
		expect(threads).toHaveLength(1);
		expect(threads[0]?.comments.map((entry) => entry.body)).toEqual([
			"Why does this fall back to the primary org?",
			"A reply",
		]);
	});

	it("toggles a thread's resolved state", async () => {
		const runId = harness.seedRun();
		const port = await harness.start();
		const thread = await harness.createThread(port, runId);

		const resolved = await harness.request(port, "PATCH", `/api/comment-threads/${thread.id}`, {
			resolved: true,
		});
		expect((resolved.body as CommentThread).resolvedAt).not.toBeNull();

		const reopened = await harness.request(port, "PATCH", `/api/comment-threads/${thread.id}`, {
			resolved: false,
		});
		expect((reopened.body as CommentThread).resolvedAt).toBeNull();
	});

	it("edits a comment body", async () => {
		const runId = harness.seedRun();
		const port = await harness.start();
		const thread = await harness.createThread(port, runId);

		const response = await harness.request(
			port,
			"PATCH",
			`/api/comments/${thread.comments[0]?.id}`,
			{ body: "Edited" },
		);
		expect(response.status).toBe(200);
		expect(response.body).toMatchObject({ body: "Edited" });
	});
});
