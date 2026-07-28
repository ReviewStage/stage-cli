import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ghOrThrow } from "../github/exec.js";

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

		await expect(ghOrThrow(["api", "user"], tmpDir, { timeoutMs: 50 })).rejects.toThrow();

		expect(Date.now() - startedAt).toBeLessThan(1_000);
	});
});
