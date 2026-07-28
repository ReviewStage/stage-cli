import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commentThread } from "../db/schema/index.js";
import { REVIEW_ACTION_SCOPE, ReviewActionQueue } from "../runs/review-action-queue.js";
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
		expect(log.filter((line) => line === "create-review")).toHaveLength(1);
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

	it("serializes a local reply with a lock held by another queue instance", async () => {
		await harness.writeGhShim(EMPTY_REVIEW);
		const localThreadId = harness.seedLocalThread();
		const [thread] = harness.db
			.select({ repoRoot: commentThread.repoRoot })
			.from(commentThread)
			.where(eq(commentThread.id, localThreadId))
			.limit(1)
			.all();
		if (!thread) throw new Error("seeded thread was not found");

		let releaseLock: () => void = () => {
			throw new Error("Local mutation gate was not initialized");
		};
		const gate = new Promise<void>((resolve) => {
			releaseLock = resolve;
		});
		let lockHeld = false;
		const blocker = new ReviewActionQueue().run(
			{ kind: REVIEW_ACTION_SCOPE.CHECKOUT, repoRoot: thread.repoRoot },
			async () => {
				lockHeld = true;
				await gate;
			},
		);
		await expect.poll(() => lockHeld).toBe(true);

		const reply = harness.request(
			await harness.start(),
			"POST",
			`/api/comment-threads/${localThreadId}/replies`,
			{ body: "Wait for the promotion lock" },
		);
		let replySettled = false;
		void reply.then(() => {
			replySettled = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(replySettled).toBe(false);

		releaseLock();
		expect((await reply).status).toBe(201);
		await blocker;
	});
});
