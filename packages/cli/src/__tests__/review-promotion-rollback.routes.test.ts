import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { comment, commentThread } from "../db/schema/index.js";
import {
	EMPTY_REVIEW,
	makePublishedInterruptedPromotionReview,
	ReviewRouteHarness,
} from "./review-test-harness.js";

let harness: ReviewRouteHarness;

beforeEach(async () => {
	harness = new ReviewRouteHarness();
	await harness.setup();
});

afterEach(async () => {
	vi.restoreAllMocks();
	await harness.teardown();
});

describe("review API — promotion rollback", () => {
	it("preserves resolved state when promoting a local thread", async () => {
		await harness.writeGhShim(EMPTY_REVIEW);
		const runId = harness.insertRun();
		const localThreadId = harness.seedLocalThread({ resolved: true });

		const res = await promote(runId, localThreadId);

		expect(res.status).toBe(200);
		expect((await harness.logLines()).filter((line) => line === "resolve-thread")).toHaveLength(1);
		expect(harness.db.select().from(commentThread).all()).toHaveLength(0);
	});

	it("leaves a promoted resolved thread open when GitHub denies resolution", async () => {
		await harness.writeGhShim(EMPTY_REVIEW, { addedThreadCanResolve: false });
		const runId = harness.insertRun();
		const localThreadId = harness.seedLocalThread({ resolved: true });

		const res = await promote(runId, localThreadId);

		expect(res.status, res.body).toBe(200);
		expect((await harness.logLines()).filter((line) => line === "resolve-thread")).toHaveLength(0);
		expect(harness.db.select().from(commentThread).all()).toHaveLength(0);
	});

	it("rolls back a new remote root when preserving resolution fails", async () => {
		await harness.writeGhShim(EMPTY_REVIEW, { failResolve: true });
		const runId = harness.insertRun();
		const localThreadId = harness.seedLocalThread({ resolved: true });

		const res = await promote(runId, localThreadId);

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

	it("reports a failure to discard a fresh review after its action fails", async () => {
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		await harness.writeGhShim(EMPTY_REVIEW, {
			failAddThread: true,
			failDiscardReview: true,
		});
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/comment`,
			{ filePath: "src/foo.ts", side: "additions", startLine: 3, endLine: 3, body: "Bad" },
		);

		expect(res.status).toBe(500);
		expect(stderr).toHaveBeenCalledWith(
			expect.stringContaining(
				"Failed to discard newly created GitHub review after action failure: gh: discard failed",
			),
		);
	});

	it("keeps the whole local thread when a promoted reply fails", async () => {
		await harness.writeGhShim(EMPTY_REVIEW, { failAddReply: true });
		const runId = harness.insertRun();
		const localThreadId = harness.seedLocalThread({ withReply: true });

		const res = await promote(runId, localThreadId);

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

	it("preserves insertion order when comments share a timestamp", async () => {
		await harness.writeGhShim(EMPTY_REVIEW);
		const runId = harness.insertRun();
		const localThreadId = harness.seedLocalThread({ withReply: true });
		harness.db
			.update(comment)
			.set({ createdAt: new Date(0) })
			.where(eq(comment.threadId, localThreadId))
			.run();

		const res = await promote(runId, localThreadId);
		const addThread = (await harness.logLines()).find((line) => line.startsWith("add-thread"));

		expect(res.status, res.body).toBe(200);
		expect(addThread).toContain("body=Root");
	});

	it("never deletes a published root when a resumed promotion fails", async () => {
		await harness.writeGhShim(makePublishedInterruptedPromotionReview(), { failResolve: true });
		const runId = harness.insertRun();
		const localThreadId = harness.seedLocalThread({ resolved: true });
		harness.db
			.update(commentThread)
			.set({
				promotionPullRequestNodeId: "PR_node",
				promotionThreadNodeId: "THREAD_new",
				promotionRootCommentNodeId: "COMMENT_new",
			})
			.run();

		const promotion = await promote(runId, localThreadId);
		const [savedThread] = harness.db.select().from(commentThread).all();

		expect(promotion.status).toBe(500);
		expect((await harness.logLines()).filter((line) => line === "delete-comment")).toHaveLength(0);
		expect(savedThread?.promotionThreadNodeId).toBe("THREAD_new");
		expect(savedThread?.promotionRootCommentNodeId).toBe("COMMENT_new");
	});
});

async function promote(runId: string, localThreadId: string) {
	return harness.request(await harness.start(), "POST", `/api/runs/${runId}/review/add`, {
		localThreadId,
	});
}
