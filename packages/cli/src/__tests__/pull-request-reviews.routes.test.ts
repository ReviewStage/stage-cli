import type { ReviewsResponse } from "@stagereview/types/pull-request";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	PullRequestRouteHarness,
	REST_PR_JSON,
	REST_REVIEWS_JSON,
} from "./pull-request-route-harness.js";

let harness: PullRequestRouteHarness;

beforeEach(async () => {
	harness = new PullRequestRouteHarness();
	await harness.setup();
});

afterEach(async () => {
	await harness.teardown();
});

describe("pull-request API — reviews", () => {
	it("maps reviewers and preserves bot identity from REST", async () => {
		await harness.writeFakeGh({ reviews: REST_REVIEWS_JSON, restPr: REST_PR_JSON });
		const runId = harness.insertRun();
		const response = await harness.request(
			await harness.start(),
			`/api/runs/${runId}/pull-request/reviews?number=7`,
		);
		const { reviews } = JSON.parse(response.body) as ReviewsResponse;

		expect(reviews?.status).toBe("approved");
		expect(reviews?.reviewers).toEqual([
			{
				user: {
					login: "alice",
					type: "User",
					avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
				},
				status: "APPROVED",
			},
			{
				user: {
					login: "cursor[bot]",
					type: "Bot",
					avatar_url: "https://avatars.githubusercontent.com/in/1210556?v=4",
				},
				status: "COMMENTED",
			},
			{
				user: {
					login: "bob",
					type: "User",
					avatar_url: "https://avatars.githubusercontent.com/u/2?v=4",
				},
				status: "REQUESTED",
			},
		]);
	});

	it("treats a re-requested approved reviewer as awaiting review", async () => {
		const restPr = JSON.stringify({
			user: { login: "octocat", type: "User", avatar_url: "https://example.com/o.png" },
			requested_reviewers: [
				{
					login: "alice",
					type: "User",
					avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
				},
			],
		});
		await harness.writeFakeGh({ reviews: REST_REVIEWS_JSON, restPr });
		const runId = harness.insertRun();
		const response = await harness.request(
			await harness.start(),
			`/api/runs/${runId}/pull-request/reviews?number=7`,
		);
		const { reviews } = JSON.parse(response.body) as ReviewsResponse;
		expect(reviews?.reviewers.find((reviewer) => reviewer.user.login === "alice")?.status).toBe(
			"REQUESTED",
		);
	});

	it("keeps a re-requested changes review blocking", async () => {
		const reviews = JSON.stringify([
			[
				{
					user: { login: "carol", type: "User", avatar_url: "https://example.com/c.png" },
					state: "CHANGES_REQUESTED",
				},
			],
		]);
		const restPr = JSON.stringify({
			user: { login: "octocat", type: "User", avatar_url: "https://example.com/o.png" },
			requested_reviewers: [
				{ login: "carol", type: "User", avatar_url: "https://example.com/c.png" },
			],
		});
		await harness.writeFakeGh({ reviews, restPr });
		const runId = harness.insertRun();
		const response = await harness.request(
			await harness.start(),
			`/api/runs/${runId}/pull-request/reviews?number=7`,
		);
		const body = JSON.parse(response.body) as ReviewsResponse;

		expect(
			body.reviews?.reviewers.find((reviewer) => reviewer.user.login === "carol")?.status,
		).toBe("CHANGES_REQUESTED");
		expect(body.reviews?.status).toBe("changes_requested");
	});
});
