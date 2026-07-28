import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REVIEW_QUERY_RESULT, ReviewRouteHarness } from "./review-test-harness.js";

let harness: ReviewRouteHarness;

beforeEach(async () => {
	harness = new ReviewRouteHarness();
	await harness.setup();
	await harness.writeGhShim(REVIEW_QUERY_RESULT);
});

afterEach(async () => {
	await harness.teardown();
});

describe("review API — GitHub mutations", () => {
	it("discards a pending review", async () => {
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/discard`,
		);

		expect(res.status).toBe(200);
		expect(await harness.logLines()).toContain("discard-review");
	});

	it("adds a pending reply", async () => {
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/reply`,
			{ threadNodeId: "THREAD_pending", body: "Reply", pending: true },
		);

		expect(res.status).toBe(200);
		expect(await harness.logLines()).toContain("reply");
	});

	it("edits a pending comment", async () => {
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/comment/edit`,
			{ nodeId: "COMMENT_pending", body: "Updated" },
		);

		expect(res.status).toBe(200);
		expect((await harness.logLines()).some((line) => line.startsWith("edit-comment"))).toBe(true);
	});

	it("deletes a pending comment", async () => {
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/comment/delete`,
			{ nodeId: "COMMENT_pending" },
		);

		expect(res.status).toBe(200);
		expect(await harness.logLines()).toContain("delete-comment");
	});

	it("resolves a GitHub review thread", async () => {
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/resolve`,
			{ threadNodeId: "THREAD_pending", resolved: true },
		);

		expect(res.status).toBe(200);
		expect(await harness.logLines()).toContain("resolve-thread");
	});
});
