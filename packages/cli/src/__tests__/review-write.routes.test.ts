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

	it("copies local replies into the promoted thread", async () => {
		await harness.writeGhShim(EMPTY_REVIEW);
		const runId = harness.insertRun();
		const localThreadId = harness.seedLocalThread({ withReply: true });

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/add`,
			{ localThreadId },
		);

		expect(res.status, res.body).toBe(200);
		expect((await harness.logLines()).filter((line) => line === "reply")).toHaveLength(1);
		expect(harness.db.select().from(commentThread).all()).toHaveLength(0);
	});

	it("resolves the promoted GitHub thread when the local thread was resolved", async () => {
		await harness.writeGhShim(EMPTY_REVIEW);
		const runId = harness.insertRun();
		const localThreadId = harness.seedLocalThread({ resolved: true });

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/add`,
			{ localThreadId },
		);

		expect(res.status, res.body).toBe(200);
		expect(await harness.logLines()).toContain("resolve-thread");
		expect(harness.db.select().from(commentThread).all()).toHaveLength(0);
	});
});
