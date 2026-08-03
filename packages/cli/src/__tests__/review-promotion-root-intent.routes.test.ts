import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commentThread } from "../db/schema/index.js";
import { EMPTY_REVIEW, ReviewRouteHarness } from "./review-test-harness.js";

let harness: ReviewRouteHarness;

beforeEach(async () => {
	harness = new ReviewRouteHarness();
	await harness.setup();
});

afterEach(async () => {
	await harness.teardown();
});

describe("review API — promotion root intent", () => {
	it("recovers a root accepted immediately before the client loses the response", async () => {
		await harness.writeGhShim(EMPTY_REVIEW, { failAddThreadAfterWrite: true });
		const runId = harness.insertRun();
		const localThreadId = harness.seedLocalThread();
		const port = await harness.start();

		const interrupted = await harness.request(port, "POST", `/api/runs/${runId}/review/add`, {
			localThreadId,
		});
		const [intent] = harness.db.select().from(commentThread).all();

		expect(interrupted.status).toBe(500);
		expect(intent?.promotionPullRequestNodeId).toBe("PR_node");
		expect(intent?.promotionThreadNodeId).toBeNull();
		expect(intent?.promotionRootCommentNodeId).toBeNull();

		const resumed = await harness.request(port, "POST", `/api/runs/${runId}/review/add`, {
			localThreadId,
		});
		const addThreadCalls = (await harness.logLines()).filter((line) =>
			line.startsWith("add-thread"),
		);

		expect(resumed.status, resumed.body).toBe(200);
		expect(addThreadCalls).toHaveLength(1);
		expect(harness.db.select().from(commentThread).all()).toHaveLength(0);
	});

	it("recovers the new anchored root after its marker is edited on GitHub", async () => {
		await harness.writeGhShim(EMPTY_REVIEW, {
			failAddThreadAfterWrite: true,
			replaceCreatedThreadBodyBeforeFailure: true,
		});
		const runId = harness.insertRun();
		const localThreadId = harness.seedLocalThread();
		const port = await harness.start();

		const interrupted = await harness.request(port, "POST", `/api/runs/${runId}/review/add`, {
			localThreadId,
		});
		const [intent] = harness.db.select().from(commentThread).all();
		const resumed = await harness.request(port, "POST", `/api/runs/${runId}/review/add`, {
			localThreadId,
		});
		const addThreadCalls = (await harness.logLines()).filter((line) =>
			line.startsWith("add-thread"),
		);

		expect(interrupted.status).toBe(500);
		expect(intent?.promotionRootBaselineThreadNodeIds).toEqual([]);
		expect(resumed.status, resumed.body).toBe(200);
		expect(addThreadCalls).toHaveLength(1);
		expect(harness.db.select().from(commentThread).all()).toHaveLength(0);
	});
});
