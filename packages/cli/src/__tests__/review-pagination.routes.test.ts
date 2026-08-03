import { ReviewResponseSchema } from "@stagereview/types/review";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REVIEW_QUERY_RESULT, ReviewRouteHarness } from "./review-test-harness.js";

let harness: ReviewRouteHarness;

beforeEach(async () => {
	harness = new ReviewRouteHarness();
	await harness.setup();
});

afterEach(async () => {
	vi.restoreAllMocks();
	await harness.teardown();
});

describe("review API — paginated snapshots", () => {
	it("rejects thread pages fetched from different pull request heads", async () => {
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		await harness.writeGhShim(REVIEW_QUERY_RESULT, {
			secondReviewPageHeadRefOid: "d".repeat(40),
		});
		const runId = harness.insertRun();

		const response = await harness.request(
			await harness.start(),
			"GET",
			`/api/runs/${runId}/review`,
		);
		const review = ReviewResponseSchema.parse(JSON.parse(response.body));

		expect(review.github).toBe("offline");
		expect(review.threads).toEqual([]);
		expect(stderr).toHaveBeenCalledWith(
			expect.stringContaining("Pull request changed while GitHub review pages were loading"),
		);
	});
});
