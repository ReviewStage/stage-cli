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

describe("review API — merge base", () => {
	it("filters the compare response before buffering it", async () => {
		await harness.writeGhShim(REVIEW_QUERY_RESULT);
		const runId = harness.insertRun();

		const res = await harness.request(await harness.start(), "GET", `/api/runs/${runId}/review`);

		expect(res.status).toBe(200);
		const compareCall = (await harness.ghArgvCalls()).find((args) =>
			args.some((arg) => arg.includes("/compare/")),
		);
		expect(compareCall).toEqual(expect.arrayContaining(["--jq", ".merge_base_commit.sha"]));
	});

	it("reports offline when the compare response has no merge base", async () => {
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		await harness.writeGhShim(REVIEW_QUERY_RESULT, { mergeBaseOid: "null" });
		const runId = harness.insertRun();

		const res = await harness.request(await harness.start(), "GET", `/api/runs/${runId}/review`);

		const review = ReviewResponseSchema.parse(JSON.parse(res.body));
		expect(review.github).toBe("offline");
		expect(stderr).toHaveBeenCalledWith(expect.stringContaining("Failed to load GitHub review"));
	});

	it("hides GitHub threads when the run does not match the PR merge base", async () => {
		await harness.writeGhShim(REVIEW_QUERY_RESULT, { mergeBaseOid: "d".repeat(40) });
		const runId = harness.insertRun();

		const res = await harness.request(await harness.start(), "GET", `/api/runs/${runId}/review`);

		const review = ReviewResponseSchema.parse(JSON.parse(res.body));
		expect(review.github).toBe("available");
		expect(review.threads).toHaveLength(0);
		expect(review.hasPendingReview).toBe(true);
		expect(review.canWriteToGitHub).toBe(false);
	});
});
