import { describe, expect, it } from "vitest";
import { REVIEW_ACTION_SCOPE, ReviewActionQueue } from "../runs/review-action-queue.js";

describe("ReviewActionQueue", () => {
	it("serializes actions sharing a scope in submission order", async () => {
		const queue = new ReviewActionQueue();
		const events: string[] = [];
		let releaseFirst: () => void = () => {
			throw new Error("First action gate was not initialized");
		};
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});

		const first = queue.run(
			{ kind: REVIEW_ACTION_SCOPE.LOCAL_THREAD, threadId: "thread-1" },
			async () => {
				events.push("first:start");
				await firstGate;
				events.push("first:end");
			},
		);
		await expect.poll(() => events).toEqual(["first:start"]);

		const second = queue.run(
			{ kind: REVIEW_ACTION_SCOPE.LOCAL_THREAD, threadId: "thread-1" },
			async () => {
				events.push("second");
			},
		);
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(events).toEqual(["first:start"]);

		releaseFirst();
		await Promise.all([first, second]);
		expect(events).toEqual(["first:start", "first:end", "second"]);
	});

	it("shares one queue for the same pull request regardless of name casing", async () => {
		const queue = new ReviewActionQueue();
		const events: string[] = [];
		let releaseFirst: () => void = () => {
			throw new Error("First action gate was not initialized");
		};
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});

		const first = queue.run(
			{
				kind: REVIEW_ACTION_SCOPE.PULL_REQUEST,
				owner: "ReviewStage",
				repo: "stage-cli",
				prNumber: 70,
			},
			async () => {
				events.push("first:start");
				await firstGate;
				events.push("first:end");
			},
		);
		await expect.poll(() => events).toEqual(["first:start"]);

		const second = queue.run(
			{
				kind: REVIEW_ACTION_SCOPE.PULL_REQUEST,
				owner: "reviewstage",
				repo: "STAGE-CLI",
				prNumber: 70,
			},
			async () => {
				events.push("second");
			},
		);
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(events).toEqual(["first:start"]);

		releaseFirst();
		await Promise.all([first, second]);
		expect(events).toEqual(["first:start", "first:end", "second"]);
	});

	it("runs the next action after a failure", async () => {
		const queue = new ReviewActionQueue();
		const scope = { kind: REVIEW_ACTION_SCOPE.LOCAL_THREAD, threadId: "thread-1" } as const;

		await expect(
			queue.run(scope, async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		await expect(queue.run(scope, async () => "after")).resolves.toBe("after");
	});
});
