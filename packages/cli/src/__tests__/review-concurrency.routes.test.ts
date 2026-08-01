import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chapterRun, comment } from "../db/schema/index.js";
import {
	addLocalThreadToReview,
	isLocalThreadPromoting,
	isLocalThreadPromotionPending,
} from "../runs/review.js";
import { REVIEW_ACTION_SCOPE, reviewActions } from "../runs/review-action-queue.js";
import { EMPTY_REVIEW, ReviewRouteHarness } from "./review-test-harness.js";

let harness: ReviewRouteHarness;

beforeEach(async () => {
	harness = new ReviewRouteHarness();
	await harness.setup();
});

afterEach(async () => {
	await harness.teardown();
});

describe("review API — concurrency", () => {
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
		expect(log.filter((line) => line.startsWith("create-review"))).toHaveLength(1);
		expect(log.filter((line) => line.startsWith("add-thread"))).toHaveLength(2);
	});

	it("rejects a local reply while its thread is being promoted", async () => {
		await harness.writeGhShim(EMPTY_REVIEW, { addThreadDelayMs: 150 });
		const runId = harness.insertRun();
		const localThreadId = harness.seedLocalThread();
		const port = await harness.start();

		const promotion = harness.request(port, "POST", `/api/runs/${runId}/review/add`, {
			localThreadId,
		});
		await expect
			.poll(async () => (await harness.logLines()).some((line) => line.startsWith("add-thread")), {
				timeout: 5_000,
			})
			.toBe(true);
		const reply = await harness.request(
			port,
			"POST",
			`/api/comment-threads/${localThreadId}/replies`,
			{ body: "Too late" },
		);

		expect(reply.status).toBe(409);
		expect((await promotion).status).toBe(200);
	});

	it("freezes a local thread while its promotion is queued for the checkout", async () => {
		await harness.writeGhShim(EMPTY_REVIEW);
		const runId = harness.insertRun();
		const localThreadId = harness.seedLocalThread();
		const [run] = harness.db
			.select()
			.from(chapterRun)
			.where(eq(chapterRun.id, runId))
			.limit(1)
			.all();
		if (!run) throw new Error("seeded run was not found");
		const port = await harness.start();
		let releaseCheckout: (() => void) | undefined;
		const blocker = reviewActions.run(
			{ kind: REVIEW_ACTION_SCOPE.CHECKOUT, repoRoot: run.repoRoot },
			() =>
				new Promise<void>((resolve) => {
					releaseCheckout = resolve;
				}),
		);
		await expect.poll(() => releaseCheckout !== undefined).toBe(true);

		const promotion = addLocalThreadToReview(harness.db, run, localThreadId);
		expect(isLocalThreadPromotionPending(harness.db, localThreadId)).toBe(true);
		const reply = await harness.request(
			port,
			"POST",
			`/api/comment-threads/${localThreadId}/replies`,
			{ body: "Must wait" },
		);

		expect(reply.status).toBe(409);
		releaseCheckout?.();
		await blocker;
		await promotion;
	});

	it("freezes direct comment edits and deletes while promotion is queued", async () => {
		await harness.writeGhShim(EMPTY_REVIEW);
		const runId = harness.insertRun();
		const localThreadId = harness.seedLocalThread();
		const [run] = harness.db.select().from(chapterRun).where(eq(chapterRun.id, runId)).all();
		const [root] = harness.db
			.select()
			.from(comment)
			.where(eq(comment.threadId, localThreadId))
			.all();
		if (!run || !root) throw new Error("seeded review data was not found");
		const port = await harness.start();
		let releaseCheckout: (() => void) | undefined;
		const blocker = reviewActions.run(
			{ kind: REVIEW_ACTION_SCOPE.CHECKOUT, repoRoot: run.repoRoot },
			() =>
				new Promise<void>((resolve) => {
					releaseCheckout = resolve;
				}),
		);
		await expect.poll(() => releaseCheckout !== undefined).toBe(true);
		const promotion = addLocalThreadToReview(harness.db, run, localThreadId);

		const edit = harness.request(port, "PATCH", `/api/comments/${root.id}`, { body: "Too late" });
		const deletion = harness.request(port, "DELETE", `/api/comments/${root.id}`);
		releaseCheckout?.();
		const [editResponse, deleteResponse] = await Promise.all([edit, deletion]);
		await blocker;
		await promotion;

		expect([editResponse.status, deleteResponse.status]).toEqual([409, 409]);
	});

	it("promotes an edit that wins the checkout lock before promotion", async () => {
		await harness.writeGhShim(EMPTY_REVIEW);
		const runId = harness.insertRun();
		const localThreadId = harness.seedLocalThread();
		const [run] = harness.db
			.select()
			.from(chapterRun)
			.where(eq(chapterRun.id, runId))
			.limit(1)
			.all();
		if (!run) throw new Error("seeded run was not found");

		const edit = reviewActions.run(
			{ kind: REVIEW_ACTION_SCOPE.CHECKOUT, repoRoot: run.repoRoot },
			async () => {
				if (isLocalThreadPromoting(harness.db, localThreadId)) {
					throw new Error("Winning edit was incorrectly rejected as mid-promotion");
				}
				harness.db
					.update(comment)
					.set({ body: "Edited before promotion" })
					.where(eq(comment.threadId, localThreadId))
					.run();
			},
		);
		const promotion = addLocalThreadToReview(harness.db, run, localThreadId);

		const [editResult, promotionResult] = await Promise.allSettled([edit, promotion]);
		expect(editResult.status).toBe("fulfilled");
		expect(promotionResult.status).toBe("fulfilled");
		expect((await harness.logLines()).find((line) => line.startsWith("add-thread"))).toContain(
			"body=Edited before promotion",
		);
	});
});
