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

describe("comment threads API — lifecycle and scope", () => {
	it("keeps a thread until its final comment is deleted", async () => {
		const runId = harness.seedRun();
		const port = await harness.start();
		const thread = await harness.createThread(port, runId);
		const reply = await harness.request(port, "POST", `/api/comment-threads/${thread.id}/replies`, {
			body: "Reply",
		});

		await harness.request(port, "DELETE", `/api/comments/${(reply.body as { id: string }).id}`);
		const afterReply = await harness.request(port, "GET", `/api/runs/${runId}/comment-threads`);
		expect(afterReply.body as CommentThread[]).toHaveLength(1);

		await harness.request(port, "DELETE", `/api/comments/${thread.comments[0]?.id}`);
		const afterRoot = await harness.request(port, "GET", `/api/runs/${runId}/comment-threads`);
		expect(afterRoot.body as CommentThread[]).toHaveLength(0);
	});

	it("deletes a thread and its comments idempotently", async () => {
		const runId = harness.seedRun();
		const port = await harness.start();
		const thread = await harness.createThread(port, runId);
		await harness.request(port, "POST", `/api/comment-threads/${thread.id}/replies`, {
			body: "Reply",
		});

		expect(
			(await harness.request(port, "DELETE", `/api/comment-threads/${thread.id}`)).status,
		).toBe(200);
		expect(harness.db.select().from(commentThread).all()).toHaveLength(0);
		expect(harness.db.select().from(comment).all()).toHaveLength(0);
		expect(
			(await harness.request(port, "DELETE", `/api/comment-threads/${thread.id}`)).status,
		).toBe(200);
	});

	it("preserves threads across imports of the same diff scope", async () => {
		const firstRunId = harness.seedRun();
		const port = await harness.start();
		await harness.createThread(port, firstRunId, { body: "Survives regeneration" });

		const secondRunId = harness.seedRun();
		expect(secondRunId).not.toBe(firstRunId);
		const response = await harness.request(port, "GET", `/api/runs/${secondRunId}/comment-threads`);
		const threads = response.body as CommentThread[];
		expect(threads).toHaveLength(1);
		expect(threads[0]?.comments[0]?.body).toBe("Survives regeneration");
	});

	it("isolates threads across different diff scopes", async () => {
		const firstRunId = harness.seedRun({
			scope: {
				kind: "committed",
				baseSha: "a".repeat(40),
				headSha: "b".repeat(40),
				mergeBaseSha: "c".repeat(40),
			},
		});
		const secondRunId = harness.seedRun({
			scope: {
				kind: "committed",
				baseSha: "d".repeat(40),
				headSha: "e".repeat(40),
				mergeBaseSha: "f".repeat(40),
			},
		});
		const port = await harness.start();
		await harness.createThread(port, firstRunId);

		const response = await harness.request(port, "GET", `/api/runs/${secondRunId}/comment-threads`);
		expect(response.body as CommentThread[]).toHaveLength(0);
	});

	it("returns 404 for unknown runs", async () => {
		const unknown = "00000000-0000-0000-0000-000000000000";
		const port = await harness.start();
		expect(
			(await harness.request(port, "GET", `/api/runs/${unknown}/comment-threads`)).status,
		).toBe(404);
		expect(
			(
				await harness.request(
					port,
					"POST",
					`/api/runs/${unknown}/comment-threads`,
					harness.makeThreadBody(),
				)
			).status,
		).toBe(404);
	});

	it("returns 404 when replying to an unknown thread", async () => {
		const port = await harness.start();
		const response = await harness.request(port, "POST", "/api/comment-threads/nope/replies", {
			body: "hi",
		});
		expect(response.status).toBe(404);
	});

	it("rejects empty bodies and inverted line ranges", async () => {
		const runId = harness.seedRun();
		const port = await harness.start();
		const path = `/api/runs/${runId}/comment-threads`;

		const emptyBody = await harness.request(port, "POST", path, {
			...harness.makeThreadBody(),
			body: "",
		});
		expect(emptyBody.status).toBe(400);

		const inverted = await harness.request(port, "POST", path, {
			...harness.makeThreadBody(),
			startLine: 10,
			endLine: 5,
		});
		expect(inverted.status).toBe(400);
	});
});
