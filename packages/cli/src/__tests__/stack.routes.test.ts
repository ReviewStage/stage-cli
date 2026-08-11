import type { PullRequestStackResponse } from "@stagereview/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GITHUB_ORIGIN, PullRequestRouteHarness } from "./pull-request-route-harness.js";

// A two-PR stack: #7 (feature ← main) and #8 (feat-2 ← feature), both in-repo.
const STACK_PULLS_JSON = JSON.stringify([
	[
		{
			number: 7,
			title: "Base work",
			state: "open",
			draft: false,
			head: { ref: "feature", repo: { id: 1 } },
			base: { ref: "main", repo: { id: 1 } },
		},
		{
			number: 8,
			title: "Build on it",
			state: "open",
			draft: false,
			head: { ref: "feat-2", repo: { id: 1 } },
			base: { ref: "feature", repo: { id: 1 } },
		},
	],
]);

let harness: PullRequestRouteHarness;

beforeEach(async () => {
	harness = new PullRequestRouteHarness();
	await harness.setup();
});

afterEach(async () => {
	await harness.teardown();
});

async function fetchStack(runId: string): Promise<PullRequestStackResponse> {
	const response = await harness.request(
		await harness.start(),
		`/api/runs/${runId}/pull-request/stack?number=7`,
	);
	expect(response.status).toBe(200);
	return JSON.parse(response.body) as PullRequestStackResponse;
}

describe("stack API — attaching local runs", () => {
	it("attaches --pr runs by number and branch runs by import-time branch", async () => {
		await harness.writeFakeGh({ pulls: STACK_PULLS_JSON });
		const prRunId = harness.insertRun(GITHUB_ORIGIN, 7);
		const branchRunId = harness.insertRun(GITHUB_ORIGIN, null, "feat-2");

		const { stack } = await fetchStack(prRunId);

		expect(stack.map((entry) => entry.number)).toEqual([7, 8]);
		expect(stack.map((entry) => entry.runId)).toEqual([prRunId, branchRunId]);
	});

	it("prefers a stored prNumber over a headRef match for the same entry", async () => {
		await harness.writeFakeGh({ pulls: STACK_PULLS_JSON });
		const currentRunId = harness.insertRun(GITHUB_ORIGIN, 7);
		const prRunId = harness.insertRun(GITHUB_ORIGIN, 8);
		harness.insertRun(GITHUB_ORIGIN, null, "feat-2");

		const { stack } = await fetchStack(currentRunId);

		expect(stack.find((entry) => entry.number === 8)?.runId).toBe(prRunId);
	});

	it("never attaches legacy runs with neither prNumber nor headRef", async () => {
		await harness.writeFakeGh({ pulls: STACK_PULLS_JSON });
		const currentRunId = harness.insertRun(GITHUB_ORIGIN, 7);
		harness.insertRun(GITHUB_ORIGIN, null, null);

		const { stack } = await fetchStack(currentRunId);

		expect(stack.find((entry) => entry.number === 8)?.runId).toBeNull();
	});

	it("does not attach branch runs from a different repository", async () => {
		await harness.writeFakeGh({ pulls: STACK_PULLS_JSON });
		const currentRunId = harness.insertRun(GITHUB_ORIGIN, 7);
		harness.insertRun("git@github.com:other/repo.git", null, "feat-2");

		const { stack } = await fetchStack(currentRunId);

		expect(stack.find((entry) => entry.number === 8)?.runId).toBeNull();
	});
});
