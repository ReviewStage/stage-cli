import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { comment, commentThread } from "../db/schema/index.js";
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
	it("releases intent after a fresh review confirms the root was rejected", async () => {
		await harness.writeGhShim(EMPTY_REVIEW, { failAddThread: true });
		const runId = harness.insertRun();
		const localThreadId = harness.seedLocalThread();
		const [root] = harness.db.select().from(comment).all();
		if (!root) throw new Error("seeded root was not found");
		const port = await harness.start();

		const rejected = await harness.request(port, "POST", `/api/runs/${runId}/review/add`, {
			localThreadId,
		});
		const [released] = harness.db.select().from(commentThread).all();
		const edit = await harness.request(port, "PATCH", `/api/comments/${root.id}`, {
			body: "Repaired local root",
		});

		expect(rejected.status).toBe(500);
		expect(released?.promotionPullRequestNodeId).toBeNull();
		expect(edit.status, edit.body).toBe(200);
	});

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

	it("does not adopt a new anchored root after its marker is edited on GitHub", async () => {
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

		expect(interrupted.status).toBe(409);
		expect(intent?.promotionRootBaselineThreadNodeIds).toEqual([]);
		expect(resumed.status, resumed.body).toBe(409);
		expect(addThreadCalls).toHaveLength(1);
		expect(harness.db.select().from(commentThread).all()).toHaveLength(1);
	});
});
