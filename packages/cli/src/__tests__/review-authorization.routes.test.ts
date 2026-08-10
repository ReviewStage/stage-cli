import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REVIEW_QUERY_RESULT, ReviewRouteHarness } from "./review-test-harness.js";

let harness: ReviewRouteHarness;

beforeEach(async () => {
	harness = new ReviewRouteHarness();
	await harness.setup();
});

afterEach(async () => {
	await harness.teardown();
});

describe("review API — GitHub authorization", () => {
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
		[
			"reply",
			"/reply",
			{
				threadNodeId: "THREAD_other",
				body: "Nope",
				pending: false,
			},
		],
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
		expect(await harness.logLines()).not.toContainEqual(expect.stringMatching(/^edit-comment/));
	});
});
