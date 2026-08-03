import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_REVIEW, ReviewRouteHarness } from "./review-test-harness.js";

let harness: ReviewRouteHarness;

beforeEach(async () => {
	harness = new ReviewRouteHarness();
	await harness.setup();
});

afterEach(async () => {
	vi.restoreAllMocks();
	await harness.teardown();
});

describe("review API — newly created review cleanup", () => {
	it("discards a fresh empty review when its comment fails", async () => {
		await harness.writeGhShim(EMPTY_REVIEW, { failAddThread: true, persistCreatedReview: true });
		const runId = harness.insertRun();

		const res = await createComment(runId);

		expect(res.status).toBe(500);
		expect((await harness.logLines()).filter((line) => line === "discard-review")).toHaveLength(1);
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

	it("reports a failure to discard a fresh review after its action fails", async () => {
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		await harness.writeGhShim(EMPTY_REVIEW, {
			failAddThread: true,
			failDiscardReview: true,
			persistCreatedReview: true,
		});
		const runId = harness.insertRun();

		const res = await createComment(runId);

		expect(res.status).toBe(500);
		expect(stderr).toHaveBeenCalledWith(
			expect.stringContaining(
				"Failed to discard newly created GitHub review after action failure: gh: discard failed",
			),
		);
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
