import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commentThread } from "../db/schema/index.js";
import {
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

describe("review API — promotion resolution recovery", () => {
	it("exposes interrupted promotion recovery on a stale run", async () => {
		const review = makeResolvedInterruptedPromotionReview() as {
			data: { repository: { pullRequest: { headRefOid: string } } };
		};
		review.data.repository.pullRequest.headRefOid = "d".repeat(40);
		await harness.writeGhShim(review);
		const runId = harness.insertRun();
		const localThreadId = harness.seedLocalThread();
		harness.db
			.update(commentThread)
			.set({
				promotionPullRequestNodeId: "PR_node",
				promotionThreadNodeId: "THREAD_new",
				promotionRootCommentNodeId: "COMMENT_new",
			})
			.run();

		const port = await harness.start();
		const response = await harness.request(port, "GET", `/api/runs/${runId}/review`);
		const localResponse = await harness.request(port, "GET", `/api/runs/${runId}/comment-threads`);
		const localThread = JSON.parse(response.body).threads.find(
			(thread: { id: string }) => thread.id === localThreadId,
		);

		expect(response.status).toBe(200);
		expect(localThread).toMatchObject({ hasPromotionRecovery: true });
		expect(JSON.parse(localResponse.body)[0]).toMatchObject({ hasPromotionRecovery: true });
	});

	it("reopens a recovered GitHub thread when the local thread was reopened", async () => {
		await harness.writeGhShim(makeResolvedInterruptedPromotionReview());
		const runId = harness.insertRun();
		const localThreadId = harness.seedLocalThread();
		harness.db
			.update(commentThread)
			.set({
				promotionPullRequestNodeId: "PR_node",
				promotionThreadNodeId: "THREAD_new",
				promotionRootCommentNodeId: "COMMENT_new",
				promotionViewerLogin: "octocat",
			})
			.run();

		const response = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/add`,
			{ localThreadId },
		);

		expect(response.status, response.body).toBe(200);
		expect(await harness.logLines()).toContain("unresolve-thread");
		expect(harness.db.select().from(commentThread).all()).toHaveLength(0);
	});
});
