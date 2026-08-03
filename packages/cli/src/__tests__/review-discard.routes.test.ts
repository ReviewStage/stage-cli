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

describe("review API — discard", () => {
	it("discards a pending review", async () => {
		await harness.writeGhShim(REVIEW_QUERY_RESULT);
		const runId = harness.insertRun();

		const response = await discard(runId);

		expect(response.status).toBe(200);
		expect(await harness.logLines()).toContain("discard-review");
	});

	it("recovers when GitHub discards the review before the response is lost", async () => {
		await harness.writeGhShim(REVIEW_QUERY_RESULT, { failDiscardAfterWrite: true });
		const runId = harness.insertRun();
		const port = await harness.start();

		const interrupted = await harness.request(port, "POST", `/api/runs/${runId}/review/discard`);
		const resumed = await harness.request(port, "POST", `/api/runs/${runId}/review/discard`);

		expect(interrupted.status).toBe(500);
		expect(resumed.status, resumed.body).toBe(200);
		expect((await harness.logLines()).filter((line) => line === "discard-review")).toHaveLength(1);
	});
});

async function discard(runId: string) {
	return harness.request(await harness.start(), "POST", `/api/runs/${runId}/review/discard`);
}
