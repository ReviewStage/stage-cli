import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REVIEW_ACTION_SCOPE, ReviewActionQueue } from "../runs/review-action-queue.js";

const tempDirs: string[] = [];

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("ReviewActionQueue", () => {
	it("creates its lock directory only when the first action runs", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage-review-lock-"));
		tempDirs.push(tempDir);
		const lockDirectory = path.join(tempDir, "missing", "locks");
		const queue = new ReviewActionQueue(lockDirectory);

		await expect(fs.access(lockDirectory)).rejects.toThrow();

		await queue.run(
			{ kind: REVIEW_ACTION_SCOPE.LOCAL_THREAD, threadId: "thread-1" },
			async () => undefined,
		);

		await expect(fs.access(lockDirectory)).resolves.toBeUndefined();
	});

	it("serializes one local thread across independent queue instances", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage-review-lock-"));
		tempDirs.push(tempDir);
		const lockDirectory = path.join(tempDir, "locks");
		let releaseFirst = () => {};
		let firstStarted = false;
		let secondRan = false;
		const first = new ReviewActionQueue(lockDirectory).run(
			{ kind: REVIEW_ACTION_SCOPE.LOCAL_THREAD, threadId: "thread-1" },
			async () => {
				firstStarted = true;
				await new Promise<void>((resolve) => {
					releaseFirst = resolve;
				});
			},
		);
		await expect.poll(() => firstStarted).toBe(true);
		const second = new ReviewActionQueue(lockDirectory).run(
			{ kind: REVIEW_ACTION_SCOPE.LOCAL_THREAD, threadId: "thread-1" },
			async () => {
				secondRan = true;
			},
		);
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(secondRan).toBe(false);

		releaseFirst();
		await Promise.all([first, second]);
		expect(secondRan).toBe(true);
	});

	it("serializes the same pull request across checkout-specific queue instances", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage-review-lock-"));
		tempDirs.push(tempDir);
		const lockDirectory = path.join(tempDir, "locks");
		const events: string[] = [];
		let releaseFirst: () => void = () => {
			throw new Error("First action gate was not initialized");
		};
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});

		const first = new ReviewActionQueue(lockDirectory).run(
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

		const second = new ReviewActionQueue(lockDirectory).run(
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
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(events).toEqual(["first:start"]);

		releaseFirst();
		await Promise.all([first, second]);
		expect(events).toEqual(["first:start", "first:end", "second"]);
	});

	it("reports a compromised lock without failing a completed action", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage-review-lock-"));
		tempDirs.push(tempDir);
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		let onCompromised: ((error: Error) => unknown) | undefined;
		const queue = new ReviewActionQueue(path.join(tempDir, "locks"), async (_file, options) => {
			onCompromised = options.onCompromised;
			return async () => {
				throw Object.assign(new Error("Lock is already released"), { code: "ERELEASED" });
			};
		});
		const compromised = Object.assign(new Error("Lock ownership was lost"), {
			code: "ECOMPROMISED",
		});

		const result = queue.run(
			{ kind: REVIEW_ACTION_SCOPE.LOCAL_THREAD, threadId: "thread-1" },
			async () => {
				onCompromised?.(compromised);
				return "unsafe result";
			},
		);

		await expect(result).resolves.toBe("unsafe result");
		expect(stderr).toHaveBeenCalledWith(
			expect.stringContaining("Review action lock compromised: Lock ownership was lost"),
		);
	});
});
