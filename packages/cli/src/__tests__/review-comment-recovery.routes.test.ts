import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMPTY_REVIEW, ReviewRouteHarness } from "./review-test-harness.js";

let harness: ReviewRouteHarness;

beforeEach(async () => {
	harness = new ReviewRouteHarness();
	await harness.setup();
});

afterEach(async () => {
	await harness.teardown();
});

describe("review API — direct comment recovery", () => {
	it("recovers a comment accepted before the client loses the response", async () => {
		await harness.writeGhShim(EMPTY_REVIEW, { failAddThreadAfterWrite: true });
		const runId = harness.insertRun();
		const port = await harness.start();
		const input = {
			creationId: "00000000-0000-4000-8000-000000000001",
			filePath: "src/foo.ts",
			side: "additions",
			startLine: 3,
			endLine: 3,
			body: "Original body",
		};

		const interrupted = await harness.request(
			port,
			"POST",
			`/api/runs/${runId}/review/comment`,
			input,
		);
		const resumed = await harness.request(port, "POST", `/api/runs/${runId}/review/comment`, {
			...input,
			body: "Edited before retry",
		});
		const logs = await harness.logLines();

		expect(interrupted.status).toBe(500);
		expect(resumed.status, resumed.body).toBe(200);
		expect(logs.filter((line) => line.startsWith("add-thread"))).toHaveLength(1);
		expect(logs.filter((line) => line.startsWith("edit-comment"))).toHaveLength(1);
	});

	it("does not edit a recovered comment after the PR diff moves", async () => {
		await harness.writeGhShim(EMPTY_REVIEW, {
			failAddThreadAfterWrite: true,
			createdThreadHeadRefOidBeforeFailure: "f".repeat(40),
		});
		const runId = harness.insertRun();
		const port = await harness.start();
		const input = {
			creationId: "00000000-0000-4000-8000-000000000001",
			filePath: "src/foo.ts",
			side: "additions",
			startLine: 3,
			endLine: 3,
			body: "Original body",
		};

		await harness.request(port, "POST", `/api/runs/${runId}/review/comment`, input);
		const resumed = await harness.request(port, "POST", `/api/runs/${runId}/review/comment`, {
			...input,
			body: "Stale edit",
		});

		expect(resumed.status).toBe(409);
		expect((await harness.logLines()).filter((line) => line.startsWith("edit-comment"))).toEqual(
			[],
		);
	});

	it("allows a same-body no-op but not an edit after the PR closes", async () => {
		await harness.writeGhShim(EMPTY_REVIEW, {
			failAddThreadAfterWrite: true,
			createdThreadPullRequestStateBeforeFailure: "CLOSED",
		});
		const runId = harness.insertRun();
		const port = await harness.start();
		const input = {
			creationId: "00000000-0000-4000-8000-000000000001",
			filePath: "src/foo.ts",
			side: "additions",
			startLine: 3,
			endLine: 3,
			body: "Original body",
		};

		await harness.request(port, "POST", `/api/runs/${runId}/review/comment`, input);
		const noOp = await harness.request(port, "POST", `/api/runs/${runId}/review/comment`, input);
		const edit = await harness.request(port, "POST", `/api/runs/${runId}/review/comment`, {
			...input,
			body: "Closed edit",
		});

		expect(noOp.status, noOp.body).toBe(200);
		expect(edit.status).toBe(409);
		expect((await harness.logLines()).filter((line) => line.startsWith("edit-comment"))).toEqual(
			[],
		);
	});
});
