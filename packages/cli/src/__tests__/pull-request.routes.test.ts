import type { PullRequestResponse } from "@stagereview/types/pull-request";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	GITHUB_ORIGIN,
	PR_JSON,
	PullRequestRouteHarness,
	REST_PR_JSON,
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

describe("pull-request API — discovery", () => {
	it("maps the gh PR payload and binds discovery to the origin repository", async () => {
		await harness.writeFakeGh({ pr: PR_JSON, restPr: REST_PR_JSON });
		const runId = harness.insertRun();
		const response = await harness.request(
			await harness.start(),
			`/api/runs/${runId}/pull-request`,
		);
		const { pullRequest } = JSON.parse(response.body) as PullRequestResponse;

		expect(response.status).toBe(200);
		expect(pullRequest).toEqual({
			number: 7,
			title: "Add the thing",
			body: "This PR adds the thing.\n\nDetails here.",
			html_url: "https://github.com/owner/repo/pull/7",
			state: "open",
			draft: false,
			merged_at: null,
			created_at: "2026-05-01T00:00:00Z",
			user: {
				login: "octocat",
				type: "User",
				avatar_url: "https://avatars.githubusercontent.com/u/583231?v=4",
			},
			head: { ref: "feature", sha: SHA },
			base: { ref: "main" },
		});
		expect(await harness.argv()).toContain("--repo owner/repo");
	});

	it("coerces a null gh body to an empty string", async () => {
		const prNoBody = JSON.stringify({ ...JSON.parse(PR_JSON), body: null });
		await harness.writeFakeGh({ pr: prNoBody, restPr: REST_PR_JSON });
		const runId = harness.insertRun();

		const response = await harness.request(
			await harness.start(),
			`/api/runs/${runId}/pull-request`,
		);
		expect((JSON.parse(response.body) as PullRequestResponse).pullRequest?.body).toBe("");
	});

	it("loads a targeted PR by number from the origin repository", async () => {
		await harness.writeFakeGh({ pr: PR_JSON, restPr: REST_PR_JSON });
		const runId = harness.insertRun(GITHUB_ORIGIN, 7);

		const response = await harness.request(
			await harness.start(),
			`/api/runs/${runId}/pull-request`,
		);
		expect((JSON.parse(response.body) as PullRequestResponse).pullRequest?.number).toBe(7);
		expect(await harness.argv()).toContain("pr view 7 --json");
		expect(await harness.argv()).toContain("--repo owner/repo");
	});

	it("returns null when gh finds no PR for the branch", async () => {
		await harness.writeFakeGh({});
		const runId = harness.insertRun();
		const response = await harness.request(
			await harness.start(),
			`/api/runs/${runId}/pull-request`,
		);
		expect((JSON.parse(response.body) as PullRequestResponse).pullRequest).toBeNull();
	});

	it("returns null for non-GitHub remotes", async () => {
		await harness.writeFakeGh({ pr: PR_JSON });
		const runId = harness.insertRun("git@gitlab.com:owner/repo.git");
		const response = await harness.request(
			await harness.start(),
			`/api/runs/${runId}/pull-request`,
		);
		expect((JSON.parse(response.body) as PullRequestResponse).pullRequest).toBeNull();
	});

	it("returns 404 for an unknown run", async () => {
		const response = await harness.request(
			await harness.start(),
			"/api/runs/00000000-0000-0000-0000-000000000000/pull-request",
		);
		expect(response.status).toBe(404);
	});
});
