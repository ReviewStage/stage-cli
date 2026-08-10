import { ReviewResponseSchema } from "@stagereview/types/review";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	makeAnchorlessPendingReview,
	makeSummaryOnlyPendingReview,
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

describe("review API — pending review recovery", () => {
	it("lists and submits an anchorless pending draft", async () => {
		await harness.writeGhShim(makeAnchorlessPendingReview());
		const runId = harness.insertRun();
		const port = await harness.start();

		const read = await harness.request(port, "GET", `/api/runs/${runId}/review`);
		const review = ReviewResponseSchema.parse(JSON.parse(read.body));
		const submit = await harness.request(port, "POST", `/api/runs/${runId}/review/submit`, {
			event: "COMMENT",
			body: "",
		});

		expect(review.pendingComments).toEqual([
			{ id: "COMMENT_outdated", filePath: "src/foo.ts", line: null, body: "Outdated draft" },
		]);
		expect(submit.status).toBe(200);
	});

	it("edits and deletes an anchorless pending draft by its returned id", async () => {
		await harness.writeGhShim(makeAnchorlessPendingReview());
		const runId = harness.insertRun();
		const port = await harness.start();

		const edit = await harness.request(port, "POST", `/api/runs/${runId}/review/comment/edit`, {
			nodeId: "COMMENT_outdated",
			body: "Updated draft",
		});
		const remove = await harness.request(port, "POST", `/api/runs/${runId}/review/comment/delete`, {
			nodeId: "COMMENT_outdated",
		});

		expect(edit.status).toBe(200);
		expect(remove.status).toBe(200);
		expect(await harness.logLines()).toEqual(
			expect.arrayContaining([expect.stringMatching(/^edit-comment/), "delete-comment"]),
		);
	});

	it("preserves and submits a summary-only pending review", async () => {
		await harness.writeGhShim(makeSummaryOnlyPendingReview());
		const runId = harness.insertRun();
		const port = await harness.start();

		const read = await harness.request(port, "GET", `/api/runs/${runId}/review`);
		const review = ReviewResponseSchema.parse(JSON.parse(read.body));
		const submit = await harness.request(port, "POST", `/api/runs/${runId}/review/submit`, {
			event: "COMMENT",
			body: "Existing draft summary",
		});

		expect(review.pendingReviewBody).toBe("Existing draft summary");
		expect(submit.status).toBe(200);
		expect((await harness.logLines()).find((line) => line.startsWith("submit"))).toContain(
			"body=Existing draft summary",
		);
	});
});
