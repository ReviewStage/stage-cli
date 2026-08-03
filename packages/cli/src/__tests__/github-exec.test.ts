import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ghReadOrThrow, ghWriteOrThrow } from "../github/exec.js";

let tmpDir: string;
let originalPath: string | undefined;

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage-gh-timeout-"));
	originalPath = process.env.PATH;
	process.env.PATH = `${tmpDir}${path.delimiter}${originalPath ?? ""}`;
});

afterEach(async () => {
	process.env.PATH = originalPath;
	await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("gh execution", () => {
	it("terminates a hung gh process at the configured deadline", async () => {
		const shimPath = path.join(tmpDir, "gh");
		await fs.writeFile(shimPath, "#!/bin/sh\nexec sleep 5\n");
		await fs.chmod(shimPath, 0o755);
		const startedAt = Date.now();

		await expect(ghReadOrThrow(["api", "user"], tmpDir, { timeoutMs: 50 })).rejects.toThrow();

		expect(Date.now() - startedAt).toBeLessThan(1_000);
	});

	it("does not impose the passive-read deadline on mutation execution", async () => {
		const shimPath = path.join(tmpDir, "gh");
		await fs.writeFile(shimPath, "#!/bin/sh\nsleep 0.1\nprintf accepted\n");
		await fs.chmod(shimPath, 0o755);

		await expect(ghWriteOrThrow(["api", "graphql"], tmpDir)).resolves.toBe("accepted");
	});

	it("rejects normally when gh exits before consuming mutation input", async () => {
		const shimPath = path.join(tmpDir, "gh");
		await fs.writeFile(shimPath, "#!/bin/sh\nexit 1\n");
		await fs.chmod(shimPath, 0o755);

		await expect(
			ghWriteOrThrow(["api", "graphql", "--input", "-"], tmpDir, {
				stdin: "x".repeat(2 * 1024 * 1024),
			}),
		).rejects.toThrow();
	});
});
