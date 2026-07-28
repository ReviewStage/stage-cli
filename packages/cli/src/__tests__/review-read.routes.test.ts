import { ReviewResponseSchema } from "@stagereview/types/review";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HEAD, REVIEW_QUERY_RESULT, ReviewRouteHarness } from "./review-test-harness.js";

let harness: ReviewRouteHarness;

beforeEach(async () => {
	harness = new ReviewRouteHarness();
	await harness.setup();
});

afterEach(async () => {
	await harness.teardown();
});

describe("review API — read", () => {
	it("returns local-only when the run has no GitHub remote", async () => {
		const runId = harness.insertRun({ originUrl: null });
		harness.seedLocalThread();

		const res = await harness.request(await harness.start(), "GET", `/api/runs/${runId}/review`);

		expect(res.status).toBe(200);
		const review = ReviewResponseSchema.parse(JSON.parse(res.body));
		expect(review.github).toBe("none");
		expect(review.threads[0]?.source).toBe("local");
	});

	it("merges local, pending, and submitted GitHub threads", async () => {
		await harness.writeGhShim(REVIEW_QUERY_RESULT);
		const runId = harness.insertRun();
		harness.seedLocalThread();

		const res = await harness.request(await harness.start(), "GET", `/api/runs/${runId}/review`);

		const review = ReviewResponseSchema.parse(JSON.parse(res.body));
		expect(review.github).toBe("available");
		expect(review.pendingCommentCount).toBe(1);
		expect(review.pendingComments).toEqual([
			{ id: "COMMENT_pending", filePath: "src/bar.ts", line: 4, body: "Draft comment" },
		]);
		expect(review.threads.map((t) => t.comments[0]?.state).sort()).toEqual([
			"local",
			"pending",
			"submitted",
		]);
	});

	it("keeps local threads visible when GitHub is offline", async () => {
		await harness.writeFailingGhShim();
		const runId = harness.insertRun();
		harness.seedLocalThread();

		const res = await harness.request(await harness.start(), "GET", `/api/runs/${runId}/review`);

		const review = ReviewResponseSchema.parse(JSON.parse(res.body));
		expect(review.github).toBe("offline");
		expect(review.threads).toHaveLength(1);
	});

	it("reports offline when the PR cannot be resolved", async () => {
		await harness.writeGhShim({ data: { repository: { pullRequest: null } } });
		const runId = harness.insertRun();

		const res = await harness.request(await harness.start(), "GET", `/api/runs/${runId}/review`);

		const review = ReviewResponseSchema.parse(JSON.parse(res.body));
		expect(review.github).toBe("offline");
		expect(review.canPushToReview).toBe(false);
	});

	it("hides GitHub threads when the run does not match the PR head", async () => {
		await harness.writeGhShim(REVIEW_QUERY_RESULT);
		const runId = harness.insertRun({ headSha: HEAD.replaceAll("a", "d") });

		const res = await harness.request(await harness.start(), "GET", `/api/runs/${runId}/review`);

		const review = ReviewResponseSchema.parse(JSON.parse(res.body));
		expect(review.github).toBe("none");
		expect(review.threads.every((t) => t.source === "local")).toBe(true);
	});
});
