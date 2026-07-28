import { ReviewResponseSchema } from "@stagereview/types/review";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { comment, commentThread } from "../db/schema/index.js";
import {
	EMPTY_REVIEW,
	makeAnchorlessPendingReview,
	ReviewRouteHarness,
} from "./review-test-harness.js";

let harness: ReviewRouteHarness;

beforeEach(async () => {
	harness = new ReviewRouteHarness();
	await harness.setup();
});

afterEach(async () => {
	await harness.teardown();
});

describe("review API — recovery and concurrency", () => {
	it("lists and submits an anchorless pending draft", async () => {
		await harness.writeGhShim(makeAnchorlessPendingReview());
		const runId = harness.insertRun();
		const port = await harness.start();

		const read = await harness.request(port, "GET", `/api/runs/${runId}/review`);
		const review = ReviewResponseSchema.parse(JSON.parse(read.body));
		const submit = await harness.request(port, "POST", `/api/runs/${runId}/review/submit`, {
			event: "COMMENT",
			body: "",
		});

		expect(review.pendingComments).toEqual([
			{ id: "COMMENT_outdated", filePath: "src/foo.ts", line: null, body: "Outdated draft" },
		]);
		expect(submit.status).toBe(200);
	});

	it("serializes concurrent first comments onto one pending review", async () => {
		await harness.writeGhShim(EMPTY_REVIEW, {
			persistCreatedReview: true,
			reviewQueryDelayMs: 75,
		});
		const runId = harness.insertRun();
		const port = await harness.start();
		const body = {
			filePath: "src/foo.ts",
			side: "additions",
			startLine: 3,
			endLine: 3,
			body: "On the PR",
		};

		const responses = await Promise.all([
			harness.request(port, "POST", `/api/runs/${runId}/review/comment`, body),
			harness.request(port, "POST", `/api/runs/${runId}/review/comment`, body),
		]);

		expect(responses.map((res) => res.status)).toEqual([200, 200]);
		const log = await harness.logLines();
		expect(log.filter((line) => line === "create-review")).toHaveLength(1);
		expect(log.filter((line) => line.startsWith("add-thread"))).toHaveLength(2);
	});

	it("preserves resolved state when promoting a local thread", async () => {
		await harness.writeGhShim(EMPTY_REVIEW);
		const runId = harness.insertRun();
		const localThreadId = harness.seedLocalThread({ resolved: true });

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/add`,
			{
				localThreadId,
			},
		);

		expect(res.status).toBe(200);
		expect((await harness.logLines()).filter((line) => line === "resolve-thread")).toHaveLength(1);
		expect(harness.db.select().from(commentThread).all()).toHaveLength(0);
	});

	it("rolls back a new remote root when preserving resolution fails", async () => {
		await harness.writeGhShim(EMPTY_REVIEW, { failResolve: true });
		const runId = harness.insertRun();
		const localThreadId = harness.seedLocalThread({ resolved: true });

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/add`,
			{
				localThreadId,
			},
		);

		expect(res.status).toBe(500);
		expect((await harness.logLines()).filter((line) => line === "delete-comment")).toHaveLength(1);
		expect(harness.db.select().from(commentThread).all()).toHaveLength(1);
	});

	it("discards a fresh empty review when its comment fails", async () => {
		await harness.writeGhShim(EMPTY_REVIEW, { failAddThread: true });
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/comment`,
			{ filePath: "src/foo.ts", side: "additions", startLine: 3, endLine: 3, body: "Bad" },
		);

		expect(res.status).toBe(500);
		expect((await harness.logLines()).filter((line) => line === "discard-review")).toHaveLength(1);
	});

	it("keeps an unposted reply local after promotion fails", async () => {
		await harness.writeGhShim(EMPTY_REVIEW, { failAddReply: true });
		const runId = harness.insertRun();
		const localThreadId = harness.seedLocalThread({ withReply: true });

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/add`,
			{
				localThreadId,
			},
		);

		expect(res.status).toBe(500);
		expect(
			harness.db
				.select()
				.from(comment)
				.all()
				.map((row) => row.body),
		).toEqual(["Reply"]);
		expect(harness.db.select().from(commentThread).all()).toHaveLength(1);
	});
});
