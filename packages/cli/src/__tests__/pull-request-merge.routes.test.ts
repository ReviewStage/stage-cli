import type { MergeStatusResponse } from "@stagereview/types/pull-request";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MERGE_JSON, PullRequestRouteHarness } from "./pull-request-route-harness.js";

let harness: PullRequestRouteHarness;

beforeEach(async () => {
	harness = new PullRequestRouteHarness();
	await harness.setup();
});

afterEach(async () => {
	await harness.teardown();
});

describe("pull-request API — merge status", () => {
	it("maps the merge-status GraphQL response", async () => {
		await harness.writeFakeGh({ merge: MERGE_JSON });
		const runId = harness.insertRun();
		const response = await harness.request(
			await harness.start(),
			`/api/runs/${runId}/pull-request/merge-status?number=7`,
		);
		const { mergeStatus } = JSON.parse(response.body) as MergeStatusResponse;

		expect(response.status).toBe(200);
		expect(mergeStatus).toMatchObject({
			mergeable: "MERGEABLE",
			mergeStateStatus: "CLEAN",
			reviewDecision: "APPROVED",
			checkRollupState: "SUCCESS",
			isInMergeQueue: false,
			allowedMergeMethods: ["MERGE", "SQUASH"],
		});
	});
});
