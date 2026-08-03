import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	EMPTY_REVIEW,
	makeOwnPullRequestReview,
	makeStalePendingReview,
	makeSummaryOnlyPendingReview,
	REVIEW_QUERY_RESULT,
	ReviewRouteHarness,
} from "./review-test-harness.js";

let harness: ReviewRouteHarness;
const SUBMISSION_ID = "00000000-0000-4000-8000-000000000001";

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
			{ creationId: SUBMISSION_ID, event: "APPROVE", body: "LGTM" },
		);

		expect(res.status).toBe(200);
		expect((await harness.logLines()).find((line) => line.startsWith("submit"))).toContain(
			"event=APPROVE",
		);
	});

	it("submits a pending review created on an earlier head commit", async () => {
		await harness.writeGhShim(makeStalePendingReview());
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/submit`,
			{
				creationId: SUBMISSION_ID,
				event: "COMMENT",
				body: "Finish the existing review",
			},
		);

		expect(res.status, res.body).toBe(200);
		expect(await harness.logLines()).toContainEqual(expect.stringMatching(/^submit/));
	});

	it("rejects an empty comment review", async () => {
		await harness.writeGhShim(EMPTY_REVIEW);
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/submit`,
			{ creationId: SUBMISSION_ID, event: "COMMENT", body: "   " },
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
			{ creationId: SUBMISSION_ID, event: "REQUEST_CHANGES", body: "   " },
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
			{ creationId: SUBMISSION_ID, event: "APPROVE", body: "LGTM" },
		);

		expect(res.status).toBe(400);
		expect(JSON.parse(res.body).error).toMatch(/own pull request/i);
		expect((await harness.logLines()).join("\n")).not.toMatch(/create-review|submit/);
	});

	it("allows an existing pending summary to be cleared", async () => {
		await harness.writeGhShim(makeSummaryOnlyPendingReview());
		const runId = harness.insertRun();

		const submit = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/submit`,
			{ creationId: SUBMISSION_ID, event: "APPROVE", body: "" },
		);
		const log = (await harness.logLines()).find((line) => line.startsWith("submit")) ?? "";

		expect(submit.status).toBe(200);
		expect(log).toContain("body=");
		expect(log).not.toContain("Existing draft summary");
	});

	it("recovers a submitted review after the client loses the response", async () => {
		await harness.writeGhShim(REVIEW_QUERY_RESULT, { failSubmitAfterWrite: true });
		const runId = harness.insertRun();
		const port = await harness.start();
		const input = { creationId: SUBMISSION_ID, event: "APPROVE", body: "LGTM" };

		const interrupted = await harness.request(
			port,
			"POST",
			`/api/runs/${runId}/review/submit`,
			input,
		);
		const resumed = await harness.request(port, "POST", `/api/runs/${runId}/review/submit`, input);
		const log = await harness.logLines();

		expect(interrupted.status).toBe(500);
		expect(resumed.status, resumed.body).toBe(200);
		expect(log.filter((line) => line.startsWith("submit"))).toHaveLength(1);
		expect(log.filter((line) => line.startsWith("create-review"))).toHaveLength(0);
	});
});
