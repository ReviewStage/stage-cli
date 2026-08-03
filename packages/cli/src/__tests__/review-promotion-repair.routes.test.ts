import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { comment, commentInsertionOrder, commentThread } from "../db/schema/index.js";
import {
	EMPTY_REVIEW,
	makeInterruptedPromotionReview,
	makeInterruptedPromotionReviewWithSubmittedReply,
	makePublishedInterruptedPromotionReview,
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

describe("review API — failed promotion repair", () => {
	it("allows the rejected reply to be edited while keeping the remote prefix frozen", async () => {
		const { port, rootId, replyId } = await seedFailedReplyPromotion();

		const rootEdit = await harness.request(port, "PATCH", `/api/comments/${rootId}`, {
			body: "Changed root",
		});
		const replyEdit = await harness.request(port, "PATCH", `/api/comments/${replyId}`, {
			body: "Shortened reply",
		});

		expect(rootEdit.status).toBe(409);
		expect(replyEdit.status, replyEdit.body).toBe(200);
		expect(harness.db.select().from(comment).where(eq(comment.id, replyId)).get()?.body).toBe(
			"Shortened reply",
		);
	});

	it("allows the rejected reply to be removed", async () => {
		const { port, localThreadId, replyId } = await seedFailedReplyPromotion();

		const deletion = await harness.request(port, "DELETE", `/api/comments/${replyId}`);

		expect(deletion.status, deletion.body).toBe(200);
		expect(
			harness.db.select().from(comment).where(eq(comment.threadId, localThreadId)).all(),
		).toHaveLength(1);
	});

	it("allows a checkpointed reply to be repaired after its GitHub comment is deleted", async () => {
		await harness.writeGhShim(makeInterruptedPromotionReview());
		const { port, localThreadId, comments } = await seedCheckpointedThread();
		harness.db
			.update(commentThread)
			.set({ promotionReplyCount: 1, promotionReplyNodeIds: ["COMMENT_deleted_reply"] })
			.where(eq(commentThread.id, localThreadId))
			.run();

		const edit = await harness.request(port, "PATCH", `/api/comments/${comments[1]}`, {
			body: "Replacement reply",
		});

		expect(edit.status, edit.body).toBe(200);
	});

	it("freezes a published remote prefix while allowing its unpromoted suffix", async () => {
		await harness.writeGhShim(makeInterruptedPromotionReviewWithSubmittedReply(), {
			recoveryRootState: "COMMENTED",
		});
		const { port, localThreadId } = await seedCheckpointedThread();
		harness.db.insert(comment).values({ threadId: localThreadId, body: "Rejected reply" }).run();
		harness.db
			.update(commentThread)
			.set({
				promotionRootPublished: true,
				promotionReplyCount: 1,
				promotionReplyNodeIds: ["COMMENT_reply"],
			})
			.where(eq(commentThread.id, localThreadId))
			.run();
		const comments = commentIds(localThreadId);

		const statuses = await Promise.all(
			comments.map(
				async (commentId) =>
					(
						await harness.request(port, "PATCH", `/api/comments/${commentId}`, {
							body: "Changed",
						})
					).status,
			),
		);

		expect(statuses).toEqual([409, 409, 200]);
	});

	it("records a published root before freezing its local copy", async () => {
		await harness.writeGhShim(makePublishedInterruptedPromotionReview(), {
			recoveryRootState: "COMMENTED",
		});
		const { port, localThreadId, comments } = await seedCheckpointedThread();

		const rootEdit = await harness.request(port, "PATCH", `/api/comments/${comments[0]}`, {
			body: "Changed root",
		});
		const newReply = await harness.request(
			port,
			"POST",
			`/api/comment-threads/${localThreadId}/replies`,
			{ body: "New local suffix" },
		);

		expect(rootEdit.status).toBe(409);
		expect(newReply.status, newReply.body).toBe(201);
		expect(
			harness.db.select().from(commentThread).where(eq(commentThread.id, localThreadId)).get()
				?.promotionRootPublished,
		).toBe(true);
	});

	it("returns unavailable without changing a reply when GitHub cannot verify it", async () => {
		const { port, replyId } = await seedFailedReplyPromotion();
		await harness.writeFailingGhShim();

		const edit = await harness.request(port, "PATCH", `/api/comments/${replyId}`, {
			body: "Changed while offline",
		});

		expect(edit.status).toBe(503);
		expect(harness.db.select().from(comment).where(eq(comment.id, replyId)).get()?.body).toBe(
			"Reply",
		);
	});
});

async function seedCheckpointedThread(): Promise<{
	port: number;
	localThreadId: string;
	comments: string[];
}> {
	harness.insertRun();
	const localThreadId = harness.seedLocalThread({ withReply: true });
	harness.db
		.update(commentThread)
		.set({
			promotionPullRequestNodeId: "PR_node",
			promotionThreadNodeId: "THREAD_new",
			promotionRootCommentNodeId: "COMMENT_new",
			promotionViewerLogin: "octocat",
		})
		.where(eq(commentThread.id, localThreadId))
		.run();
	return { port: await harness.start(), localThreadId, comments: commentIds(localThreadId) };
}

function commentIds(localThreadId: string): string[] {
	return harness.db
		.select({ id: comment.id })
		.from(comment)
		.where(eq(comment.threadId, localThreadId))
		.orderBy(asc(comment.createdAt), asc(commentInsertionOrder))
		.all()
		.map((row) => row.id);
}

async function seedFailedReplyPromotion(): Promise<{
	port: number;
	localThreadId: string;
	rootId: string;
	replyId: string;
}> {
	await harness.writeGhShim(EMPTY_REVIEW, { failAddReply: true });
	const runId = harness.insertRun();
	const localThreadId = harness.seedLocalThread({ withReply: true });
	const port = await harness.start();
	const promotion = await harness.request(port, "POST", `/api/runs/${runId}/review/add`, {
		localThreadId,
	});
	const comments = commentIds(localThreadId);
	const rootId = comments[0];
	const replyId = comments[1];
	if (!rootId || !replyId) throw new Error("Expected local promotion comments");
	expect(promotion.status).toBe(500);
	return { port, localThreadId, rootId, replyId };
}
