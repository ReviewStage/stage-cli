import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commentThread } from "../db/schema/index.js";
import { EMPTY_REVIEW, HEAD, ReviewRouteHarness } from "./review-test-harness.js";

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

		expect(res.status, res.body).toBe(200);
		expect(harness.db.select().from(commentThread).all()).toHaveLength(0);
		const createReviewLogs = (await harness.logLines()).filter((line) =>
			line.startsWith("create-review"),
		);
		expect(createReviewLogs).toHaveLength(1);
		expect(createReviewLogs[0]).toContain(`commitOID=${HEAD}`);
	});

	it("rejects a local thread from another repository with the same diff", async () => {
		await harness.writeGhShim(EMPTY_REVIEW);
		const runId = harness.insertRun();
		const localThreadId = harness.seedLocalThread({ repoRoot: "/other/repository" });

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/add`,
			{ localThreadId },
		);

		expect(res.status).toBe(400);
		expect(JSON.parse(res.body)).toEqual({
			error: expect.stringMatching(/repository/i),
		});
	});

	it("keeps an ambiguous legacy thread visible and claimable", async () => {
		await harness.writeGhShim(EMPTY_REVIEW);
		const runId = harness.insertRun();
		const localThreadId = harness.seedLocalThread({ repoRoot: "" });
		const port = await harness.start();

		const read = await harness.request(port, "GET", `/api/runs/${runId}/review`);
		const promote = await harness.request(port, "POST", `/api/runs/${runId}/review/add`, {
			localThreadId,
		});

		expect(JSON.parse(read.body).threads).toEqual([
			expect.objectContaining({ id: localThreadId, source: "local" }),
		]);
		expect(promote.status).toBe(200);
		expect(harness.db.select().from(commentThread).all()).toHaveLength(0);
	});

	it("restores an ambiguous legacy claim when the remote write fails", async () => {
		await harness.writeGhShim(EMPTY_REVIEW, { failAddThread: true });
		const runId = harness.insertRun();
		const localThreadId = harness.seedLocalThread({ repoRoot: "" });

		const promote = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/add`,
			{ localThreadId },
		);
		const [thread] = harness.db.select().from(commentThread).all();

		expect(promote.status).toBe(500);
		expect(thread?.repoRoot).toBe("");
	});
});
