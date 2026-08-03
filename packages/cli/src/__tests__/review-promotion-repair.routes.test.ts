import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { comment, commentInsertionOrder } from "../db/schema/index.js";
import { EMPTY_REVIEW, ReviewRouteHarness } from "./review-test-harness.js";

let harness: ReviewRouteHarness;

beforeEach(async () => {
	harness = new ReviewRouteHarness();
	await harness.setup();
});

afterEach(async () => {
	await harness.teardown();
});

describe("review API — failed promotion repair", () => {
	it("allows the rejected reply to be edited while keeping the remote prefix frozen", async () => {
		const { port, rootId, replyId } = await seedFailedReplyPromotion();

		const rootEdit = await harness.request(port, "PATCH", `/api/comments/${rootId}`, {
			body: "Changed root",
		});
		const replyEdit = await harness.request(port, "PATCH", `/api/comments/${replyId}`, {
			body: "Shortened reply",
		});

		expect(rootEdit.status).toBe(409);
		expect(replyEdit.status, replyEdit.body).toBe(200);
		expect(harness.db.select().from(comment).where(eq(comment.id, replyId)).get()?.body).toBe(
			"Shortened reply",
		);
	});

	it("allows the rejected reply to be removed", async () => {
		const { port, localThreadId, replyId } = await seedFailedReplyPromotion();

		const deletion = await harness.request(port, "DELETE", `/api/comments/${replyId}`);

		expect(deletion.status, deletion.body).toBe(200);
		expect(
			harness.db.select().from(comment).where(eq(comment.threadId, localThreadId)).all(),
		).toHaveLength(1);
	});
});

async function seedFailedReplyPromotion(): Promise<{
	port: number;
	localThreadId: string;
	rootId: string;
	replyId: string;
}> {
	await harness.writeGhShim(EMPTY_REVIEW, { failAddReply: true });
	const runId = harness.insertRun();
	const localThreadId = harness.seedLocalThread({ withReply: true });
	const port = await harness.start();
	const promotion = await harness.request(port, "POST", `/api/runs/${runId}/review/add`, {
		localThreadId,
	});
	const comments = harness.db
		.select({ id: comment.id })
		.from(comment)
		.where(eq(comment.threadId, localThreadId))
		.orderBy(asc(comment.createdAt), asc(commentInsertionOrder))
		.all();
	const rootId = comments[0]?.id;
	const replyId = comments[1]?.id;
	if (!rootId || !replyId) throw new Error("Expected local promotion comments");
	expect(promotion.status).toBe(500);
	return { port, localThreadId, rootId, replyId };
}
