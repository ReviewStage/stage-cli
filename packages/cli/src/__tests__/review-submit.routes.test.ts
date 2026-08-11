import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	EMPTY_REVIEW,
	makeOwnPullRequestReview,
	makeSummaryOnlyPendingReview,
	REVIEW_QUERY_RESULT,
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

describe("review API — submission", () => {
	it("submits the pending review with the chosen event", async () => {
		await harness.writeGhShim(REVIEW_QUERY_RESULT);
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/submit`,
			{ event: "APPROVE", body: "LGTM" },
		);

		expect(res.status).toBe(200);
		expect((await harness.logLines()).find((line) => line.startsWith("submit"))).toContain(
			"event=APPROVE",
		);
	});

	it("rejects an empty comment review", async () => {
		await harness.writeGhShim(EMPTY_REVIEW);
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/submit`,
			{ event: "COMMENT", body: "   " },
		);

		expect(res.status).toBe(400);
		expect((await harness.logLines()).join("\n")).not.toMatch(/create-review|submit/);
	});

	it("rejects a request for changes without a summary", async () => {
		await harness.writeGhShim(REVIEW_QUERY_RESULT);
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/submit`,
			{ event: "REQUEST_CHANGES", body: "   " },
		);

		expect(res.status).toBe(400);
		expect(JSON.parse(res.body)).toEqual({
			error: expect.stringMatching(/summary.*request changes/i),
		});
		expect((await harness.logLines()).join("\n")).not.toMatch(/submit/);
	});

	it("rejects a review decision on the viewer's own pull request", async () => {
		await harness.writeGhShim(makeOwnPullRequestReview());
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/submit`,
			{ event: "APPROVE", body: "LGTM" },
		);

		expect(res.status).toBe(400);
		expect(JSON.parse(res.body).error).toMatch(/own pull request/i);
		expect((await harness.logLines()).join("\n")).not.toMatch(/create-review|submit/);
	});

	it("recovers from a stale pending review by opening a fresh review and resubmitting", async () => {
		await harness.writeGhShim(REVIEW_QUERY_RESULT, {
			failSubmitReviewOnce: true,
			reviewStateAfterSubmit: "APPROVED",
		});
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/submit`,
			{ event: "APPROVE", body: "LGTM" },
		);

		expect(res.status).toBe(200);
		const log = await harness.logLines();
		expect(log.some((line) => line.startsWith("submit-fail"))).toBe(true);
		expect(log).toContain("review-state");
		expect(log.some((line) => line.startsWith("create-review"))).toBe(true);
		expect(log.some((line) => line.startsWith("submit "))).toBe(true);
	});

	it("recovers when the stale review node was deleted entirely", async () => {
		await harness.writeGhShim(REVIEW_QUERY_RESULT, {
			failSubmitReviewOnce: true,
			reviewStateAfterSubmit: null,
		});
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/submit`,
			{ event: "APPROVE", body: "" },
		);

		expect(res.status).toBe(200);
		const log = await harness.logLines();
		expect(log.some((line) => line.startsWith("create-review"))).toBe(true);
		expect(log.some((line) => line.startsWith("submit "))).toBe(true);
	});

	it("does not duplicate a decision already submitted from another session", async () => {
		await harness.writeGhShim(REVIEW_QUERY_RESULT, {
			failSubmitReviewOnce: true,
			reviewStateAfterSubmit: "APPROVED",
			restReviews: [
				[
					{
						user: { login: "octocat", type: "User", avatar_url: "https://x/o.png" },
						state: "APPROVED",
					},
				],
			],
		});
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/submit`,
			{ event: "APPROVE", body: "LGTM" },
		);

		expect(res.status).toBe(200);
		const log = await harness.logLines();
		expect(log.some((line) => line.startsWith("submit-fail"))).toBe(true);
		expect(log).toContain("rest-reviews");
		expect(log.some((line) => line.startsWith("create-review"))).toBe(false);
		expect(log.some((line) => line.startsWith("submit "))).toBe(false);
	});

	it("treats a null submitPullRequestReview payload as a stale review and recovers", async () => {
		await harness.writeGhShim(REVIEW_QUERY_RESULT, {
			nullSubmitPayloadOnce: true,
			reviewStateAfterSubmit: "APPROVED",
		});
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/submit`,
			{ event: "APPROVE", body: "LGTM" },
		);

		expect(res.status).toBe(200);
		const log = await harness.logLines();
		expect(log.some((line) => line.startsWith("submit-null"))).toBe(true);
		expect(log).toContain("review-state");
		expect(log.some((line) => line.startsWith("create-review"))).toBe(true);
		expect(log.some((line) => line.startsWith("submit "))).toBe(true);
	});

	it("aborts recovery with a conflict when the reviews summary can't be read", async () => {
		await harness.writeGhShim(REVIEW_QUERY_RESULT, {
			failSubmitReviewOnce: true,
			reviewStateAfterSubmit: "APPROVED",
			failRestReviews: true,
		});
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/submit`,
			{ event: "APPROVE", body: "LGTM" },
		);

		expect(res.status).toBe(409);
		expect(JSON.parse(res.body).error).toMatch(/no longer pending/i);
		const log = await harness.logLines();
		expect(log).toContain("rest-reviews");
		expect(log.some((line) => line.startsWith("create-review"))).toBe(false);
		expect(log.some((line) => line.startsWith("submit "))).toBe(false);
	});

	it("surfaces the original failure when the review is still pending", async () => {
		await harness.writeGhShim(REVIEW_QUERY_RESULT, {
			failSubmitReviewOnce: true,
			reviewStateAfterSubmit: "PENDING",
		});
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/submit`,
			{ event: "APPROVE", body: "LGTM" },
		);

		expect(res.status).toBe(500);
		expect(JSON.parse(res.body).error).toMatch(/could not approve pull request review/i);
		expect((await harness.logLines()).some((line) => line.startsWith("create-review"))).toBe(false);
	});

	it("allows an existing pending summary to be cleared", async () => {
		await harness.writeGhShim(makeSummaryOnlyPendingReview());
		const runId = harness.insertRun();

		const submit = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/submit`,
			{ event: "APPROVE", body: "" },
		);
		const log = (await harness.logLines()).find((line) => line.startsWith("submit")) ?? "";

		expect(submit.status).toBe(200);
		expect(log).toContain("body=");
		expect(log).not.toContain("Existing draft summary");
	});
});
