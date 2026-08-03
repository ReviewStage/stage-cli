import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commentThread } from "../db/schema/index.js";
import { makeInterruptedPromotionReview, ReviewRouteHarness } from "./review-test-harness.js";

let harness: ReviewRouteHarness;

beforeEach(async () => {
	harness = new ReviewRouteHarness();
	await harness.setup();
});

afterEach(async () => {
	await harness.teardown();
});

describe("review API — promotion checkpoint release", () => {
	it("rejects recovery through a different pull request", async () => {
		await harness.writeGhShim(makeInterruptedPromotionReview(), {
			recoveryPullRequestNodeId: "PR_other",
			recoveryPullRequestNumber: 5,
		});
		const runId = harness.insertRun();
		const localThreadId = harness.seedLocalThread({ withReply: true });
		checkpoint(localThreadId, "PR_other");

		const promotion = await promote(runId, localThreadId);
		const [savedThread] = harness.db.select().from(commentThread).all();

		expect(promotion.status, promotion.body).toBe(409);
		expect((await harness.logLines()).filter((line) => line.startsWith("add-thread"))).toHaveLength(
			0,
		);
		expect(savedThread?.promotionPullRequestNodeId).toBeNull();
		expect(savedThread?.promotionThreadNodeId).toBeNull();
		expect((await harness.logLines()).filter((line) => line === "delete-comment")).toHaveLength(1);
	});

	it.each([
		["closed", { state: "CLOSED" as const }],
		["moved", { headRefOid: "d".repeat(40) }],
	])("releases a checkpoint after the pull request has %s", async (_state, reviewOptions) => {
		await harness.writeGhShim(makeInterruptedPromotionReview(undefined, reviewOptions));
		const { runId, localThreadId } = seedInterruptedPromotion();

		const promotion = await promote(runId, localThreadId);
		const [savedThread] = harness.db.select().from(commentThread).all();

		expect(promotion.status, promotion.body).toBe(409);
		expect(savedThread?.promotionPullRequestNodeId).toBeNull();
		expect(savedThread?.promotionThreadNodeId).toBeNull();
		expect((await harness.logLines()).filter((line) => line === "delete-comment")).toHaveLength(1);
	});

	it("releases a checkpoint without deleting a published remote root", async () => {
		await harness.writeGhShim(makeInterruptedPromotionReview(undefined, { state: "CLOSED" }), {
			recoveryRootState: "COMMENTED",
		});
		const { runId, localThreadId } = seedInterruptedPromotion();
		const port = await harness.start();

		const promotion = await harness.request(port, "POST", `/api/runs/${runId}/review/add`, {
			localThreadId,
		});
		const reply = await harness.request(
			port,
			"POST",
			`/api/comment-threads/${localThreadId}/replies`,
			{ body: "Continue locally" },
		);
		const [savedThread] = harness.db.select().from(commentThread).all();

		expect(promotion.status, promotion.body).toBe(409);
		expect(reply.status).toBe(201);
		expect(savedThread?.promotionPullRequestNodeId).toBeNull();
		expect(savedThread?.promotionThreadNodeId).toBeNull();
		expect((await harness.logLines()).filter((line) => line === "delete-comment")).toHaveLength(0);
	});
});

function seedInterruptedPromotion(): { runId: string; localThreadId: string } {
	const runId = harness.insertRun();
	const localThreadId = harness.seedLocalThread({ withReply: true });
	checkpoint(localThreadId);
	return { runId, localThreadId };
}

function checkpoint(localThreadId: string, pullRequestNodeId = "PR_node"): void {
	harness.db
		.update(commentThread)
		.set({
			promotionPullRequestNodeId: pullRequestNodeId,
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
