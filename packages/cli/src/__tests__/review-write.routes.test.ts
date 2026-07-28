import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commentThread } from "../db/schema/index.js";
import { EMPTY_REVIEW, REVIEW_QUERY_RESULT, ReviewRouteHarness } from "./review-test-harness.js";

let harness: ReviewRouteHarness;

beforeEach(async () => {
	harness = new ReviewRouteHarness();
	await harness.setup();
});

afterEach(async () => {
	await harness.teardown();
});

describe("review API — writes", () => {
	it("promotes a local thread to a pending GitHub comment", async () => {
		await harness.writeGhShim(EMPTY_REVIEW);
		const runId = harness.insertRun();
		const localThreadId = harness.seedLocalThread();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/add`,
			{
				localThreadId,
			},
		);

		expect(res.status).toBe(200);
		expect(harness.db.select().from(commentThread).all()).toHaveLength(0);
		expect((await harness.logLines()).filter((line) => line === "create-review")).toHaveLength(1);
	});

	it("creates a pending PR comment without storing it locally", async () => {
		await harness.writeGhShim(EMPTY_REVIEW);
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/comment`,
			{
				filePath: "src/foo.ts",
				side: "additions",
				startLine: 3,
				endLine: 3,
				body: "On the PR",
			},
		);

		expect(res.status).toBe(200);
		expect(harness.db.select().from(commentThread).all()).toHaveLength(0);
		expect((await harness.logLines()).some((line) => line.startsWith("add-thread"))).toBe(true);
	});

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

	it("rejects PR comments from a working-tree run", async () => {
		await harness.writeGhShim(REVIEW_QUERY_RESULT);
		const runId = harness.insertRun({ committed: false });

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/comment`,
			{
				filePath: "src/foo.ts",
				side: "additions",
				startLine: 3,
				endLine: 3,
				body: "On the PR",
			},
		);

		expect(res.status).toBe(409);
		expect(JSON.parse(res.body)).toEqual({
			error: expect.stringMatching(/committed diff/i),
		});
	});
});
