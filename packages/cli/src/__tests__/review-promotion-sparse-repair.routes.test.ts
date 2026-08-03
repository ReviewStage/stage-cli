import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { comment, commentInsertionOrder, commentThread } from "../db/schema/index.js";
import {
	makeInterruptedPromotionReviewWithSparseReplies,
	makeInterruptedPromotionReviewWithSubmittedReply,
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

describe("review API — sparse promotion repair", () => {
	it("recovers an ambiguous write into a sparse hole without duplicating it", async () => {
		const review = makeInterruptedPromotionReviewWithSparseReplies();
		await harness.writeGhShim(review, { failAddReplyAfterWrite: true });
		const runId = harness.insertRun();
		const localThreadId = harness.seedLocalThread({ withReply: true });
		harness.db.insert(comment).values({ threadId: localThreadId, body: "Second reply" }).run();
		harness.db.insert(comment).values({ threadId: localThreadId, body: "Third reply" }).run();
		harness.db
			.update(commentThread)
			.set({
				promotionPullRequestNodeId: "PR_node",
				promotionThreadNodeId: "THREAD_new",
				promotionRootCommentNodeId: "COMMENT_new",
				promotionViewerLogin: "octocat",
				promotionReplyCount: 3,
				promotionReplyNodeIds: ["COMMENT_first", "COMMENT_deleted", "COMMENT_third"],
			})
			.where(eq(commentThread.id, localThreadId))
			.run();
		const port = await harness.start();

		const interrupted = await harness.request(port, "POST", `/api/runs/${runId}/review/add`, {
			localThreadId,
		});
		const checkpoint = harness.db
			.select()
			.from(commentThread)
			.where(eq(commentThread.id, localThreadId))
			.get();
		const resumed = await harness.request(port, "POST", `/api/runs/${runId}/review/add`, {
			localThreadId,
		});

		expect(interrupted.status).toBe(500);
		expect(checkpoint?.promotionReplyCount).toBe(0);
		expect(checkpoint?.promotionReplyNodeIds).toEqual(["COMMENT_first", null, "COMMENT_third"]);
		expect(resumed.status, resumed.body).toBe(200);
		expect((await harness.logLines()).filter((line) => line === "reply")).toHaveLength(1);
		expect(harness.db.select().from(commentThread).all()).toHaveLength(0);
	});

	it("keeps a later reply frozen when its sparse saved node still exists", async () => {
		await harness.writeGhShim(makeInterruptedPromotionReviewWithSubmittedReply(), {
			recoveryRootState: "COMMENTED",
		});
		harness.insertRun();
		const localThreadId = harness.seedLocalThread({ withReply: true });
		harness.db.insert(comment).values({ threadId: localThreadId, body: "Second reply" }).run();
		harness.db.insert(comment).values({ threadId: localThreadId, body: "Third reply" }).run();
		harness.db
			.update(commentThread)
			.set({
				promotionPullRequestNodeId: "PR_node",
				promotionThreadNodeId: "THREAD_new",
				promotionRootCommentNodeId: "COMMENT_new",
				promotionViewerLogin: "octocat",
				promotionRootPublished: true,
				promotionReplyCount: 1,
				promotionReplyNodeIds: [null, null, "COMMENT_reply"],
			})
			.where(eq(commentThread.id, localThreadId))
			.run();
		const comments = harness.db
			.select({ id: comment.id })
			.from(comment)
			.where(eq(comment.threadId, localThreadId))
			.orderBy(asc(comment.createdAt), asc(commentInsertionOrder))
			.all();
		const sparseReplyId = comments[3]?.id;
		if (!sparseReplyId) throw new Error("Expected third local reply");

		const edit = await harness.request(
			await harness.start(),
			"PATCH",
			`/api/comments/${sparseReplyId}`,
			{ body: "Changed third reply" },
		);

		expect(edit.status).toBe(409);
		expect(harness.db.select().from(comment).where(eq(comment.id, sparseReplyId)).get()?.body).toBe(
			"Third reply",
		);
	});
});
