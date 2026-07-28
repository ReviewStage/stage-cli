import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	makeClosedReview,
	makeStalePendingReview,
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

describe("review API — GitHub boundaries", () => {
	it("keeps a closed PR's comments visible but disables writes", async () => {
		await harness.writeGhShim(makeClosedReview());
		const runId = harness.insertRun();
		const port = await harness.start();

		const read = await harness.request(port, "GET", `/api/runs/${runId}/review`);
		const edit = await harness.request(port, "POST", `/api/runs/${runId}/review/comment/edit`, {
			nodeId: "COMMENT_pending",
			body: "Nope",
		});
		const review = JSON.parse(read.body);

		expect(read.status).toBe(200);
		expect(review.github).toBe("available");
		expect(review.threads).toHaveLength(2);
		expect(review.canPushToReview).toBe(false);
		expect(edit.status).toBe(409);
		expect(JSON.parse(edit.body).error).toMatch(/closed/i);
		expect(await harness.logLines()).not.toContainEqual(expect.stringMatching(/^edit-comment/));
	});

	it("does not reuse a pending review from an earlier head commit", async () => {
		await harness.writeGhShim(makeStalePendingReview());
		const runId = harness.insertRun();
		const port = await harness.start();

		const read = await harness.request(port, "GET", `/api/runs/${runId}/review`);
		const reply = await harness.request(port, "POST", `/api/runs/${runId}/review/reply`, {
			threadNodeId: "THREAD_pending",
			body: "Nope",
			pending: true,
		});

		expect(JSON.parse(read.body).canPushToReview).toBe(false);
		expect(reply.status).toBe(409);
		expect(JSON.parse(reply.body).error).toMatch(/earlier PR version/i);
		expect(await harness.logLines()).not.toContain("reply");
	});

	it.each([
		["edit", "/comment/edit", { nodeId: "COMMENT_other", body: "Nope" }],
		["delete", "/comment/delete", { nodeId: "COMMENT_other" }],
	])("rejects a foreign node id for %s", async (_name, suffix, body) => {
		await harness.writeGhShim(REVIEW_QUERY_RESULT);
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review${suffix}`,
			body,
		);

		expect(res.status).toBe(400);
		expect(JSON.parse(res.body).error).toMatch(/isn't an editable pending comment/i);
		expect(await harness.logLines()).not.toContainEqual(
			expect.stringMatching(/^(edit|delete)-comment/),
		);
	});

	it.each([
		["reply", "/reply", { threadNodeId: "THREAD_other", body: "Nope", pending: false }],
		["resolve", "/resolve", { threadNodeId: "THREAD_other", resolved: true }],
	])("rejects a foreign thread id for %s", async (_name, suffix, body) => {
		await harness.writeGhShim(REVIEW_QUERY_RESULT);
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review${suffix}`,
			body,
		);

		expect(res.status).toBe(400);
		expect(JSON.parse(res.body).error).toMatch(/doesn't belong/i);
		expect(await harness.logLines()).not.toContainEqual(
			expect.stringMatching(/^(reply|resolve-thread)/),
		);
	});

	it("rejects editing a submitted comment even when it belongs to the PR", async () => {
		await harness.writeGhShim(REVIEW_QUERY_RESULT);
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/comment/edit`,
			{ nodeId: "COMMENT_sub", body: "Nope" },
		);

		expect(res.status).toBe(400);
		expect(JSON.parse(res.body).error).toMatch(/pending comment/i);
	});
});
