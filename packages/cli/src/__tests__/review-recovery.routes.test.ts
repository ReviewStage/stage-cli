import { ReviewResponseSchema } from "@stagereview/types/review";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { comment, commentThread } from "../db/schema/index.js";
import {
	EMPTY_REVIEW,
	makeAnchorlessPendingReview,
	makeInterruptedPromotionReview,
	makeSummaryOnlyPendingReview,
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

describe("review API — recovery", () => {
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

	it("preserves and submits a summary-only pending review", async () => {
		await harness.writeGhShim(makeSummaryOnlyPendingReview());
		const runId = harness.insertRun();
		const port = await harness.start();

		const read = await harness.request(port, "GET", `/api/runs/${runId}/review`);
		const review = ReviewResponseSchema.parse(JSON.parse(read.body));
		const submit = await harness.request(port, "POST", `/api/runs/${runId}/review/submit`, {
			event: "COMMENT",
			body: "Existing draft summary",
		});

		expect(review.pendingReviewBody).toBe("Existing draft summary");
		expect(submit.status).toBe(200);
		expect((await harness.logLines()).find((line) => line.startsWith("submit"))).toContain(
			"body=Existing draft summary",
		);
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

	it("rolls back the remote root and keeps the whole local thread when a reply fails", async () => {
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
		expect((await harness.logLines()).filter((line) => line === "delete-comment")).toHaveLength(1);
		expect(
			harness.db
				.select()
				.from(comment)
				.all()
				.map((row) => row.body),
		).toEqual(["Root", "Reply"]);
		expect(harness.db.select().from(commentThread).all()).toHaveLength(1);
	});

	it("resumes an interrupted promotion without duplicating its remote root", async () => {
		await harness.writeGhShim(makeInterruptedPromotionReview());
		const runId = harness.insertRun();
		const localThreadId = harness.seedLocalThread({ withReply: true });
		harness.db
			.update(commentThread)
			.set({
				promotionThreadNodeId: "THREAD_new",
				promotionRootCommentNodeId: "COMMENT_new",
				promotionReplyCount: 0,
			})
			.run();
		const port = await harness.start();

		const blockedReply = await harness.request(
			port,
			"POST",
			`/api/comment-threads/${localThreadId}/replies`,
			{ body: "Must wait" },
		);
		const promotion = await harness.request(port, "POST", `/api/runs/${runId}/review/add`, {
			localThreadId,
		});
		const log = await harness.logLines();

		expect(blockedReply.status).toBe(409);
		expect(promotion.status, promotion.body).toBe(200);
		expect(log.filter((line) => line.startsWith("add-thread"))).toHaveLength(0);
		expect(log.filter((line) => line === "reply")).toHaveLength(1);
		expect(harness.db.select().from(commentThread).all()).toHaveLength(0);
	});

	it("reconciles a reply that landed immediately before the process exited", async () => {
		await harness.writeGhShim(makeInterruptedPromotionReview("Reply"));
		const runId = harness.insertRun();
		const localThreadId = harness.seedLocalThread({ withReply: true });
		harness.db
			.update(commentThread)
			.set({
				promotionThreadNodeId: "THREAD_new",
				promotionRootCommentNodeId: "COMMENT_new",
			})
			.run();

		const promotion = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/add`,
			{ localThreadId },
		);
		const log = await harness.logLines();

		expect(promotion.status, promotion.body).toBe(200);
		expect(log.filter((line) => line === "reply")).toHaveLength(0);
		expect(harness.db.select().from(commentThread).all()).toHaveLength(0);
	});
});
