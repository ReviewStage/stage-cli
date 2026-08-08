import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commentThread } from "../db/schema/index.js";
import {
	EMPTY_REVIEW,
	makeUnreplyableReview,
	makeUnresolvableReview,
	REVIEW_QUERY_RESULT,
	ReviewRouteHarness,
} from "./review-test-harness.js";

let harness: ReviewRouteHarness;

beforeEach(async () => {
	harness = new ReviewRouteHarness();
	await harness.setup();
	await harness.writeGhShim(REVIEW_QUERY_RESULT);
});

afterEach(async () => {
	await harness.teardown();
});

describe("review API — GitHub mutations", () => {
	it("adds a pending reply", async () => {
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/reply`,
			{
				threadNodeId: "THREAD_pending",
				body: "Reply",
				pending: true,
			},
		);

		expect(res.status).toBe(200);
		expect(await harness.logLines()).toContain("reply");
	});

	it("rejects a reply when GitHub denies permission for the thread", async () => {
		await harness.writeGhShim(makeUnreplyableReview());
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/reply`,
			{
				threadNodeId: "THREAD_sub",
				body: "Reply",
				pending: false,
			},
		);

		expect(res.status).toBe(403);
		expect(await harness.logLines()).not.toContain("reply");
	});

	it("edits a pending comment", async () => {
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/comment/edit`,
			{ nodeId: "COMMENT_pending", body: "Updated" },
		);

		expect(res.status).toBe(200);
		expect((await harness.logLines()).some((line) => line.startsWith("edit-comment"))).toBe(true);
	});

	it("deletes a pending comment", async () => {
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/comment/delete`,
			{ nodeId: "COMMENT_pending" },
		);

		expect(res.status).toBe(200);
		expect(await harness.logLines()).toContain("delete-comment");
	});

	it("resolves a GitHub review thread", async () => {
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/resolve`,
			{ threadNodeId: "THREAD_pending", resolved: true },
		);

		expect(res.status).toBe(200);
		expect(await harness.logLines()).toContain("resolve-thread");
	});

	it("rejects resolving a thread when GitHub denies permission", async () => {
		await harness.writeGhShim(makeUnresolvableReview());
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/resolve`,
			{ threadNodeId: "THREAD_sub", resolved: true },
		);

		expect(res.status).toBe(403);
		expect(await harness.logLines()).not.toContain("resolve-thread");
	});

	it("keeps the local thread when promotion fails partway", async () => {
		await harness.writeGhShim(EMPTY_REVIEW, {
			failAddReply: true,
			persistCreatedReview: true,
		});
		const runId = harness.insertRun();
		const localThreadId = harness.seedLocalThread({ withReply: true });

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/add`,
			{ localThreadId },
		);
		const [thread] = harness.db.select().from(commentThread).all();

		expect(res.status).toBe(500);
		expect(await harness.logLines()).not.toContain("discard-review");
		expect(thread?.id).toBe(localThreadId);
	});
});
