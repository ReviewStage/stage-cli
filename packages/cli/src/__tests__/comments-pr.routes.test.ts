import type { CommentThread } from "@stagereview/types/comments";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../db/client.js";
import { chapterRun, commentThread } from "../db/schema/index.js";
import { send, setupCommentRoutesTest } from "./comment-routes-harness.js";

const env = setupCommentRoutesTest("stage-cli-comments-pr-");

/** Seed a run and stamp a prNumber on it (insertChaptersFile has no PR path in fixtures). */
function seedPrRun(prNumber: number): string {
	const runId = env.seedRun();
	const db = getDb({ dbPath: env.dbPath });
	db.update(chapterRun).set({ prNumber }).where(eq(chapterRun.id, runId)).run();
	return runId;
}

describe("pending review comments (PR runs)", () => {
	it("stamps the run's prNumber on threads created in a PR run and reports pending", async () => {
		const runId = seedPrRun(7);
		const { port } = await env.startWithRoutes();
		const thread = await env.createThread(port, runId);
		expect(thread.pending).toBe(true);
		const db = getDb({ dbPath: env.dbPath });
		const [row] = db.select().from(commentThread).all();
		expect(row?.prNumber).toBe(7);
	});

	it("creates plain local notes (pending false, prNumber null) on non-PR runs", async () => {
		const runId = env.seedRun();
		const { port } = await env.startWithRoutes();
		const thread = await env.createThread(port, runId);
		expect(thread.pending).toBe(false);
		const db = getDb({ dbPath: env.dbPath });
		expect(db.select().from(commentThread).all()[0]?.prNumber).toBeNull();
	});

	it("hides pending threads from a non-PR run of the same diff, and notes stay visible to both", async () => {
		// Same fixture → same scopeKey for both runs.
		const prRunId = seedPrRun(7);
		const plainRunId = env.seedRun();
		const { port } = await env.startWithRoutes();
		await env.createThread(port, prRunId, { body: "pending comment" });
		await env.createThread(port, plainRunId, { body: "local note" });

		const plainList = await send(port, "GET", `/api/runs/${plainRunId}/comment-threads`);
		const plainBodies = (plainList.body as CommentThread[]).flatMap((t) =>
			t.comments.map((c) => c.body),
		);
		expect(plainBodies).toEqual(["local note"]);

		const prList = await send(port, "GET", `/api/runs/${prRunId}/comment-threads`);
		const prBodies = (prList.body as CommentThread[]).flatMap((t) => t.comments.map((c) => c.body));
		expect(prBodies).toEqual(expect.arrayContaining(["pending comment", "local note"]));
	});

	it("hides pending threads for PR 7 from a run targeting PR 8", async () => {
		const run7 = seedPrRun(7);
		const run8 = seedPrRun(8);
		const { port } = await env.startWithRoutes();
		await env.createThread(port, run7, { body: "for pr 7" });
		const list = await send(port, "GET", `/api/runs/${run8}/comment-threads`);
		expect((list.body as CommentThread[]).length).toBe(0);
	});
});
