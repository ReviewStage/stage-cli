import type { ChecksResponse } from "@stagereview/types/pull-request";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	CHECKS_JSON,
	DEPLOYMENTS_JSON,
	PullRequestRouteHarness,
	SHA,
} from "./pull-request-route-harness.js";

let harness: PullRequestRouteHarness;

beforeEach(async () => {
	harness = new PullRequestRouteHarness();
	await harness.setup();
});

afterEach(async () => {
	await harness.teardown();
});

describe("pull-request API — checks", () => {
	it("returns mapped CI check items for a valid head SHA", async () => {
		await harness.writeFakeGh({ checks: CHECKS_JSON });
		const runId = harness.insertRun();
		const response = await harness.request(
			await harness.start(),
			`/api/runs/${runId}/pull-request/checks?headSha=${SHA}`,
		);
		const body = JSON.parse(response.body) as ChecksResponse;

		expect(response.status).toBe(200);
		expect(body.state).toBe("success");
		expect(body.items).toHaveLength(1);
		expect(body.items[0]).toMatchObject({
			source: "check_run",
			name: "build",
			conclusion: "success",
			avatarUrl: "https://example.com/a.png",
			appName: "GitHub Actions",
		});
	});

	it("returns the latest successful HTTPS deployment per environment", async () => {
		await harness.writeFakeGh({ checks: CHECKS_JSON, deployments: DEPLOYMENTS_JSON });
		const runId = harness.insertRun();
		const response = await harness.request(
			await harness.start(),
			`/api/runs/${runId}/pull-request/checks?headSha=${SHA}`,
		);
		const body = JSON.parse(response.body) as ChecksResponse;

		expect(body.deploymentLinks).toEqual([
			{ environment: "Preview", url: "https://preview-2.example.app" },
			{ environment: "Production", url: "https://prod.example.app" },
		]);
	});

	it("rejects a checks request without a valid head SHA", async () => {
		await harness.writeFakeGh({ checks: CHECKS_JSON });
		const runId = harness.insertRun();
		const response = await harness.request(
			await harness.start(),
			`/api/runs/${runId}/pull-request/checks?headSha=nope`,
		);
		expect(response.status).toBe(400);
	});
});
