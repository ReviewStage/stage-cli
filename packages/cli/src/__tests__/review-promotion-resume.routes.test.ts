import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commentThread } from "../db/schema/index.js";
import {
	makeInterruptedPromotionReview,
	makeInterruptedPromotionReviewWithForeignMatchingReply,
	makeInterruptedPromotionReviewWithInterleavedViewerReply,
	makeInterruptedPromotionReviewWithSubmittedReply,
	makeInterruptedPromotionReviewWithUnrelatedViewerReply,
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

	it("reconciles a viewer reply after an interleaved participant comment", async () => {
		await harness.writeGhShim(makeInterruptedPromotionReviewWithInterleavedViewerReply());
		const { runId, localThreadId } = seedInterruptedPromotion();

		const promotion = await promote(runId, localThreadId);

		expect(promotion.status, promotion.body).toBe(200);
		expect((await harness.logLines()).filter((line) => line === "reply")).toHaveLength(0);
		expect(harness.db.select().from(commentThread).all()).toHaveLength(0);
	});

	it("finds a promoted reply after an unrelated reply by the same viewer", async () => {
		await harness.writeGhShim(makeInterruptedPromotionReviewWithUnrelatedViewerReply());
		const { runId, localThreadId } = seedInterruptedPromotion();

		const promotion = await promote(runId, localThreadId);

		expect(promotion.status, promotion.body).toBe(200);
		expect((await harness.logLines()).filter((line) => line === "reply")).toHaveLength(0);
		expect(harness.db.select().from(commentThread).all()).toHaveLength(0);
	});

	it("resends a checkpointed reply that was manually deleted", async () => {
		await harness.writeGhShim(makeInterruptedPromotionReview());
		const { runId, localThreadId } = seedInterruptedPromotion();
		harness.db
			.update(commentThread)
			.set({ promotionReplyCount: 1, promotionReplyNodeIds: ["COMMENT_deleted_reply"] })
			.where(eq(commentThread.id, localThreadId))
			.run();

		const promotion = await promote(runId, localThreadId);

		expect(promotion.status, promotion.body).toBe(200);
		expect((await harness.logLines()).filter((line) => line === "reply")).toHaveLength(1);
		expect(harness.db.select().from(commentThread).all()).toHaveLength(0);
	});

	it("recognizes a checkpointed reply after it is edited on GitHub", async () => {
		await harness.writeGhShim(makeInterruptedPromotionReview("Edited remotely"));
		const { runId, localThreadId } = seedInterruptedPromotion();
		harness.db
			.update(commentThread)
			.set({ promotionReplyCount: 1, promotionReplyNodeIds: ["COMMENT_reply"] })
			.where(eq(commentThread.id, localThreadId))
			.run();

		const promotion = await promote(runId, localThreadId);

		expect(promotion.status, promotion.body).toBe(200);
		expect((await harness.logLines()).filter((line) => line === "reply")).toHaveLength(0);
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

		const promotion = await promote(runId, localThreadId);
		const [savedThread] = harness.db.select().from(commentThread).all();

		expect(promotion.status, promotion.body).toBe(409);
		expect(savedThread?.promotionPullRequestNodeId).toBe("PR_node");
		expect(savedThread?.promotionThreadNodeId).toBe("THREAD_new");
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
