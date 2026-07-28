import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commentThread } from "../db/schema/index.js";
import {
	makeInterruptedPromotionReview,
	makeInterruptedPromotionReviewWithForeignMatchingReply,
	makeInterruptedPromotionReviewWithSubmittedReply,
	makeResolvedInterruptedPromotionReview,
	ReviewRouteHarness,
} from "./review-test-harness.js";

let harness: ReviewRouteHarness;

beforeEach(async () => {
	harness = new ReviewRouteHarness();
	await harness.setup();
});

afterEach(async () => {
	await harness.teardown();
});

describe("review API — promotion resume", () => {
	it("resumes without duplicating the remote root", async () => {
		await harness.writeGhShim(makeInterruptedPromotionReview());
		const { runId, localThreadId } = seedInterruptedPromotion();
		const port = await harness.start();

		const blockedReply = await harness.request(
			port,
			"POST",
			`/api/comment-threads/${localThreadId}/replies`,
			{ body: "Must wait" },
		);
		const promotion = await harness.request(port, "POST", `/api/runs/${runId}/review/add`, {
			localThreadId,
		});
		const log = await harness.logLines();

		expect(blockedReply.status).toBe(409);
		expect(promotion.status, promotion.body).toBe(200);
		expect(log.filter((line) => line.startsWith("add-thread"))).toHaveLength(0);
		expect(log.filter((line) => line === "reply")).toHaveLength(1);
		expect(harness.db.select().from(commentThread).all()).toHaveLength(0);
	});

	it("reconciles a reply that landed immediately before exit", async () => {
		await harness.writeGhShim(makeInterruptedPromotionReview("Reply"));
		const { runId, localThreadId } = seedInterruptedPromotion();

		const promotion = await promote(runId, localThreadId);

		expect(promotion.status, promotion.body).toBe(200);
		expect((await harness.logLines()).filter((line) => line === "reply")).toHaveLength(0);
		expect(harness.db.select().from(commentThread).all()).toHaveLength(0);
	});

	it("does not mistake another participant matching reply for the local reply", async () => {
		await harness.writeGhShim(makeInterruptedPromotionReviewWithForeignMatchingReply());
		const { runId, localThreadId } = seedInterruptedPromotion();

		const promotion = await promote(runId, localThreadId);

		expect(promotion.status, promotion.body).toBe(200);
		expect((await harness.logLines()).filter((line) => line === "reply")).toHaveLength(1);
		expect(harness.db.select().from(commentThread).all()).toHaveLength(0);
	});

	it("reconciles a viewer reply after its review was submitted", async () => {
		await harness.writeGhShim(makeInterruptedPromotionReviewWithSubmittedReply());
		const { runId, localThreadId } = seedInterruptedPromotion();

		const promotion = await promote(runId, localThreadId);

		expect(promotion.status, promotion.body).toBe(200);
		expect((await harness.logLines()).filter((line) => line === "reply")).toHaveLength(0);
		expect(harness.db.select().from(commentThread).all()).toHaveLength(0);
	});

	it("does not resolve a recovered remote thread twice", async () => {
		await harness.writeGhShim(makeResolvedInterruptedPromotionReview());
		const runId = harness.insertRun();
		const localThreadId = harness.seedLocalThread({ resolved: true });
		checkpoint(localThreadId);

		const promotion = await promote(runId, localThreadId);

		expect(promotion.status, promotion.body).toBe(200);
		expect((await harness.logLines()).filter((line) => line === "resolve-thread")).toHaveLength(0);
		expect(harness.db.select().from(commentThread).all()).toHaveLength(0);
	});
});

function seedInterruptedPromotion(): { runId: string; localThreadId: string } {
	const runId = harness.insertRun();
	const localThreadId = harness.seedLocalThread({ withReply: true });
	checkpoint(localThreadId);
	return { runId, localThreadId };
}

function checkpoint(localThreadId: string): void {
	harness.db
		.update(commentThread)
		.set({
			promotionThreadNodeId: "THREAD_new",
			promotionRootCommentNodeId: "COMMENT_new",
			promotionReplyCount: 0,
		})
		.where(eq(commentThread.id, localThreadId))
		.run();
}

async function promote(runId: string, localThreadId: string) {
	return harness.request(await harness.start(), "POST", `/api/runs/${runId}/review/add`, {
		localThreadId,
	});
}
