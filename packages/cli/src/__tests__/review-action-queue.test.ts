import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ReviewActionQueue } from "../runs/review-action-queue.js";

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("ReviewActionQueue", () => {
	it("serializes independent queue instances for the same checkout", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage-review-lock-"));
		tempDirs.push(tempDir);
		const repoRoot = path.join(tempDir, "repo");
		await fs.mkdir(repoRoot);
		const events: string[] = [];
		let releaseFirst: () => void = () => {
			throw new Error("First action gate was not initialized");
		};
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});

		const first = new ReviewActionQueue().run(repoRoot, async () => {
			events.push("first:start");
			await firstGate;
			events.push("first:end");
		});
		await expect.poll(() => events).toEqual(["first:start"]);

		const second = new ReviewActionQueue().run(repoRoot, async () => {
			events.push("second");
		});
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(events).toEqual(["first:start"]);

		releaseFirst();
		await Promise.all([first, second]);
		expect(events).toEqual(["first:start", "first:end", "second"]);
	});
});
