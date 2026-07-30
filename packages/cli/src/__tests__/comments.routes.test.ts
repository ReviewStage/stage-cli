import type { CommentThread } from "@stagereview/types/comments";
import { describe, expect, it } from "vitest";
import { getDb } from "../db/client.js";
import { comment, commentThread } from "../db/schema/index.js";
import { makeThreadBody, send, setupCommentRoutesTest } from "./comment-routes-harness.js";

const env = setupCommentRoutesTest("stage-cli-comments-");

describe("comment threads API", () => {
	it("rejects a cross-origin write with 403 before any mutation", async () => {
		const { port } = await env.startWithRoutes();
		// A page on another origin can fire a no-preflight POST at the loopback server;
		// the same-origin guard must reject it up front, even without a valid run.
		const res = await send(port, "POST", "/api/runs/any/comment-threads", makeThreadBody(), {
			Origin: "http://evil.example",
		});
		expect(res.status).toBe(403);
	});

	it("POST creates a thread with its root comment and the anchor", async () => {
		const runId = env.seedRun();
		const { port } = await env.startWithRoutes();

		const thread = await env.createThread(port, runId, { body: "First!" });
		expect(thread.filePath).toBe("src/foo.ts");
		expect(thread.side).toBe("additions");
		expect(thread.startLine).toBe(5);
		expect(thread.endLine).toBe(10);
		expect(thread.resolvedAt).toBeNull();
		expect(thread.comments).toHaveLength(1);
		expect(thread.comments[0]?.body).toBe("First!");
		expect(thread.comments[0]?.authorId).toBe("local");

		const db = getDb({ dbPath: env.dbPath });
		expect(db.select().from(commentThread).all()).toHaveLength(1);
		expect(db.select().from(comment).all()).toHaveLength(1);
	});

	it("GET lists threads (oldest comment first) and returns [] when empty", async () => {
		const runId = env.seedRun();
		const { port } = await env.startWithRoutes();

		const empty = await send(port, "GET", `/api/runs/${runId}/comment-threads`);
		expect(empty.body).toEqual([]);

		const thread = await env.createThread(port, runId);
		await send(port, "POST", `/api/comment-threads/${thread.id}/replies`, { body: "A reply" });

		const list = await send(port, "GET", `/api/runs/${runId}/comment-threads`);
		const threads = list.body as CommentThread[];
		expect(threads).toHaveLength(1);
		expect(threads[0]?.comments.map((c) => c.body)).toEqual([
			"Why does this fall back to the primary org?",
			"A reply",
		]);
	});

	it("PATCH toggles a thread's resolved state", async () => {
		const runId = env.seedRun();
		const { port } = await env.startWithRoutes();
		const thread = await env.createThread(port, runId);

		const resolved = await send(port, "PATCH", `/api/comment-threads/${thread.id}`, {
			resolved: true,
		});
		expect((resolved.body as CommentThread).resolvedAt).not.toBeNull();

		const reopened = await send(port, "PATCH", `/api/comment-threads/${thread.id}`, {
			resolved: false,
		});
		expect((reopened.body as CommentThread).resolvedAt).toBeNull();
	});

	it("PATCH edits a comment body", async () => {
		const runId = env.seedRun();
		const { port } = await env.startWithRoutes();
		const thread = await env.createThread(port, runId);
		const commentId = thread.comments[0]?.id;

		const res = await send(port, "PATCH", `/api/comments/${commentId}`, { body: "Edited" });
		expect(res.status).toBe(200);
		expect((res.body as { body: string }).body).toBe("Edited");
	});

	it("DELETE comment keeps the thread while other comments remain, removes it when last", async () => {
		const runId = env.seedRun();
		const { port } = await env.startWithRoutes();
		const thread = await env.createThread(port, runId);
		const reply = await send(port, "POST", `/api/comment-threads/${thread.id}/replies`, {
			body: "Reply",
		});
		const replyId = (reply.body as { id: string }).id;
		const rootId = thread.comments[0]?.id;

		await send(port, "DELETE", `/api/comments/${replyId}`);
		const afterReplyDelete = await send(port, "GET", `/api/runs/${runId}/comment-threads`);
		expect(afterReplyDelete.body as CommentThread[]).toHaveLength(1);

		await send(port, "DELETE", `/api/comments/${rootId}`);
		const afterRootDelete = await send(port, "GET", `/api/runs/${runId}/comment-threads`);
		expect(afterRootDelete.body as CommentThread[]).toHaveLength(0);
	});

	it("DELETE thread cascades to its comments and is idempotent", async () => {
		const runId = env.seedRun();
		const { port } = await env.startWithRoutes();
		const thread = await env.createThread(port, runId);
		await send(port, "POST", `/api/comment-threads/${thread.id}/replies`, { body: "Reply" });

		const first = await send(port, "DELETE", `/api/comment-threads/${thread.id}`);
		expect(first.status).toBe(200);
		const db = getDb({ dbPath: env.dbPath });
		expect(db.select().from(commentThread).all()).toHaveLength(0);
		expect(db.select().from(comment).all()).toHaveLength(0);

		const second = await send(port, "DELETE", `/api/comment-threads/${thread.id}`);
		expect(second.status).toBe(200);
	});

	it("threads survive re-import of the same diff scope", async () => {
		// Two imports with identical scope create two runs sharing one scope key.
		// A thread created against the first run must be visible from the second.
		const runA = env.seedRun();
		const { port } = await env.startWithRoutes();
		await env.createThread(port, runA, { body: "Survives regeneration" });

		const runB = env.seedRun();
		expect(runB).not.toBe(runA);

		const viaB = await send(port, "GET", `/api/runs/${runB}/comment-threads`);
		const threads = viaB.body as CommentThread[];
		expect(threads).toHaveLength(1);
		expect(threads[0]?.comments[0]?.body).toBe("Survives regeneration");
	});

	it("threads are isolated across different diff scopes", async () => {
		const runA = env.seedRun({
			scope: {
				kind: "committed",
				baseSha: "a".repeat(40),
				headSha: "b".repeat(40),
				mergeBaseSha: "c".repeat(40),
			},
		});
		const runB = env.seedRun({
			scope: {
				kind: "committed",
				baseSha: "d".repeat(40),
				headSha: "e".repeat(40),
				mergeBaseSha: "f".repeat(40),
			},
		});
		const { port } = await env.startWithRoutes();
		await env.createThread(port, runA);

		const viaB = await send(port, "GET", `/api/runs/${runB}/comment-threads`);
		expect(viaB.body as CommentThread[]).toHaveLength(0);
	});

	it("returns 404 for an unknown run on GET and POST", async () => {
		const unknown = "00000000-0000-0000-0000-000000000000";
		const { port } = await env.startWithRoutes();

		const get = await send(port, "GET", `/api/runs/${unknown}/comment-threads`);
		expect(get.status).toBe(404);
		const post = await send(port, "POST", `/api/runs/${unknown}/comment-threads`, makeThreadBody());
		expect(post.status).toBe(404);
	});

	it("returns 404 when replying to an unknown thread", async () => {
		const { port } = await env.startWithRoutes();
		const res = await send(port, "POST", "/api/comment-threads/nope/replies", { body: "hi" });
		expect(res.status).toBe(404);
	});

	it("returns 400 for an empty body or an inverted line range", async () => {
		const runId = env.seedRun();
		const { port } = await env.startWithRoutes();

		const emptyBody = await send(port, "POST", `/api/runs/${runId}/comment-threads`, {
			...makeThreadBody(),
			body: "",
		});
		expect(emptyBody.status).toBe(400);

		const inverted = await send(port, "POST", `/api/runs/${runId}/comment-threads`, {
			...makeThreadBody(),
			startLine: 10,
			endLine: 5,
		});
		expect(inverted.status).toBe(400);
	});
});
