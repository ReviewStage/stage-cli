import { TIMELINE_EVENT_TYPE, TimelineResponseSchema } from "@stagereview/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	REVIEW_COMMENTS_JSON,
	THREAD_METADATA_JSON,
	TIMELINE_JSON,
	TimelineRouteHarness,
} from "./timeline-route-harness.js";

let harness: TimelineRouteHarness;

beforeEach(async () => {
	harness = new TimelineRouteHarness();
	await harness.setup();
});

afterEach(async () => {
	await harness.teardown();
});

async function fetchTimeline(runId: string) {
	const response = await harness.request(
		await harness.start(),
		`/api/runs/${runId}/timeline?number=7`,
	);
	expect(response.status).toBe(200);
	return TimelineResponseSchema.parse(JSON.parse(response.body)).timeline;
}

describe("timeline API — assembly", () => {
	it("assembles the timeline in date order with reviews, comments, commits, and events", async () => {
		await harness.writeFakeGh({
			timeline: TIMELINE_JSON,
			reviewComments: REVIEW_COMMENTS_JSON,
			threadMetadata: THREAD_METADATA_JSON,
		});
		const timeline = await fetchTimeline(harness.insertRun());

		expect(timeline.events.map((event) => event.type)).toEqual([
			TIMELINE_EVENT_TYPE.COMMITTED,
			TIMELINE_EVENT_TYPE.ISSUE_COMMENT,
			TIMELINE_EVENT_TYPE.LABELED,
			TIMELINE_EVENT_TYPE.REVIEW,
			TIMELINE_EVENT_TYPE.STATE_CHANGE,
		]);
		expect(timeline.reviewComments).toHaveLength(2);
	});

	it("groups review comments under their review and reassigns inline replies to the parent review", async () => {
		await harness.writeFakeGh({
			timeline: TIMELINE_JSON,
			reviewComments: REVIEW_COMMENTS_JSON,
			threadMetadata: THREAD_METADATA_JSON,
		});
		const timeline = await fetchTimeline(harness.insertRun());

		const reviews = timeline.events.filter((event) => event.type === TIMELINE_EVENT_TYPE.REVIEW);
		// The ghost COMMENTED review (id 200) loses its reply to review 100 and is dropped.
		expect(reviews).toHaveLength(1);
		const review = reviews[0];
		if (!review) throw new Error("expected a review event");
		expect(review.data.id).toBe(100);
		expect(review.comments.map((comment) => comment.id)).toEqual([1, 2]);
	});

	it("carries dismissal-free review state and drops unknown event types", async () => {
		await harness.writeFakeGh({
			timeline: TIMELINE_JSON,
			reviewComments: REVIEW_COMMENTS_JSON,
			threadMetadata: THREAD_METADATA_JSON,
		});
		const timeline = await fetchTimeline(harness.insertRun());

		expect(
			timeline.events.some(
				(event) => "id" in event.data && typeof event.data.id === "number" && event.data.id === 99,
			),
		).toBe(false);
		const merged = timeline.events.find((event) => event.type === TIMELINE_EVENT_TYPE.STATE_CHANGE);
		if (!merged || merged.type !== TIMELINE_EVENT_TYPE.STATE_CHANGE) {
			throw new Error("expected a state_change event");
		}
		expect(merged.data.event).toBe("merged");
	});

	it("maps GraphQL thread metadata onto resolved threads, node ids, and reactions", async () => {
		await harness.writeFakeGh({
			timeline: TIMELINE_JSON,
			reviewComments: REVIEW_COMMENTS_JSON,
			threadMetadata: THREAD_METADATA_JSON,
		});
		const timeline = await fetchTimeline(harness.insertRun());

		expect(timeline.resolvedThreads).toEqual({ "1": { login: "octocat" } });
		expect(timeline.threadNodeIds).toEqual({ "1": "PRRT_1" });
		expect(timeline.reactionDetails.pullRequest).toEqual({ "+1": ["alice"] });
		expect(timeline.reactionDetails.comments).toEqual({
			"11": { heart: ["bob", "alice"] },
			"1": { rocket: ["bob"] },
		});
	});

	it("requests the full media type so bodies include server-rendered HTML", async () => {
		await harness.writeFakeGh({
			timeline: TIMELINE_JSON,
			reviewComments: REVIEW_COMMENTS_JSON,
			threadMetadata: THREAD_METADATA_JSON,
		});
		await fetchTimeline(harness.insertRun());

		const argv = await harness.argv();
		expect(argv).toContain("repos/owner/repo/issues/7/timeline --paginate --slurp");
		expect(argv).toContain("repos/owner/repo/pulls/7/comments --paginate --slurp");
		expect(argv).toContain("Accept: application/vnd.github.full+json");
	});
});

describe("timeline API — gating and degradation", () => {
	it("returns 404 for runs without a GitHub remote", async () => {
		await harness.writeFakeGh({ timeline: TIMELINE_JSON });
		const runId = harness.insertRun("git@gitlab.com:owner/repo.git");
		const response = await harness.request(
			await harness.start(),
			`/api/runs/${runId}/timeline?number=7`,
		);
		expect(response.status).toBe(404);
	});

	it("returns 400 when the PR number is missing or invalid", async () => {
		await harness.writeFakeGh({ timeline: TIMELINE_JSON });
		const runId = harness.insertRun();
		const port = await harness.start();

		expect((await harness.request(port, `/api/runs/${runId}/timeline`)).status).toBe(400);
		expect((await harness.request(port, `/api/runs/${runId}/timeline?number=nope`)).status).toBe(
			400,
		);
	});

	it("degrades to 502 with the gh failure reason when GitHub is unreachable", async () => {
		await harness.writeFakeGh({});
		const runId = harness.insertRun();
		const response = await harness.request(
			await harness.start(),
			`/api/runs/${runId}/timeline?number=7`,
		);

		expect(response.status).toBe(502);
		const body = JSON.parse(response.body) as { error: string };
		expect(body.error).toContain("not authenticated");
	});

	it("returns 404 for an unknown run", async () => {
		const response = await harness.request(
			await harness.start(),
			"/api/runs/00000000-0000-0000-0000-000000000000/timeline?number=7",
		);
		expect(response.status).toBe(404);
	});
});
