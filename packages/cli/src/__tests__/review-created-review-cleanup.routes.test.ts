import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMPTY_REVIEW, ReviewRouteHarness } from "./review-test-harness.js";

let harness: ReviewRouteHarness;

beforeEach(async () => {
	harness = new ReviewRouteHarness();
	await harness.setup();
});

afterEach(async () => {
	await harness.teardown();
});

describe("review API — newly created review cleanup", () => {
	it("retains a newly opened review when its comment fails", async () => {
		await harness.writeGhShim(EMPTY_REVIEW, { failAddThread: true, persistCreatedReview: true });
		const runId = harness.insertRun();

		const res = await createComment(runId);

		expect(res.status).toBe(500);
		expect(await harness.logLines()).not.toContain("discard-review");
	});

	it("preserves a fresh review when another draft appears before cleanup", async () => {
		await harness.writeGhShim(EMPTY_REVIEW, {
			failAddThread: true,
			persistCreatedReview: true,
			addConcurrentPendingCommentOnThreadFailure: true,
		});
		const runId = harness.insertRun();

		const res = await createComment(runId);

		expect(res.status).toBe(500);
		expect(await harness.logLines()).not.toContain("discard-review");
	});
});

async function createComment(runId: string) {
	return harness.request(await harness.start(), "POST", `/api/runs/${runId}/review/comment`, {
		filePath: "src/foo.ts",
		side: "additions",
		startLine: 3,
		endLine: 3,
		body: "Bad",
	});
}
