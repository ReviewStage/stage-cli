import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseRepoName, resolveScope } from "../git.js";
import { SCOPE_KIND, WORKING_TREE_REF } from "../schema.js";

let tmpDir: string;
let originalCwd: string;

beforeEach(async () => {
	originalCwd = process.cwd();
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage-cli-git-"));
});

afterEach(async () => {
	process.chdir(originalCwd);
	await fs.rm(tmpDir, { recursive: true, force: true });
});

function git(...args: string[]): string {
	return execFileSync("git", args, {
		cwd: tmpDir,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
	});
}

async function writeFile(filePath: string, contents: string): Promise<void> {
	await fs.writeFile(path.join(tmpDir, filePath), contents);
}

async function initDivergedRepo(): Promise<{
	commonSha: string;
	mainSha: string;
	featureSha: string;
}> {
	git("init", "--initial-branch=main");
	git("config", "user.email", "test@example.com");
	git("config", "user.name", "Test");
	git("config", "commit.gpgsign", "false");

	await writeFile("file.txt", "common\n");
	git("add", "file.txt");
	git("commit", "-m", "common");
	const commonSha = git("rev-parse", "HEAD").trim();

	git("checkout", "-b", "feature");
	await writeFile("file.txt", "common\nfeature\n");
	git("commit", "-am", "feature change");
	const featureSha = git("rev-parse", "HEAD").trim();

	git("checkout", "main");
	await writeFile("file.txt", "common\nmain\n");
	git("commit", "-am", "main change");
	const mainSha = git("rev-parse", "HEAD").trim();

	process.chdir(tmpDir);
	return { commonSha, mainSha, featureSha };
}

describe("parseRepoName", () => {
	const FALLBACK_ROOT = "/Users/dev/conductor/workspaces/stage-cli/monterrey-v3";

	it("extracts the repo name from an SSH URL", () => {
		expect(parseRepoName("git@github.com:ReviewStage/stage-cli.git", FALLBACK_ROOT)).toBe(
			"stage-cli",
		);
	});

	it("extracts the repo name from an HTTPS URL", () => {
		expect(parseRepoName("https://github.com/ReviewStage/stage-cli.git", FALLBACK_ROOT)).toBe(
			"stage-cli",
		);
	});

	it("extracts the repo name from an HTTPS URL without .git suffix", () => {
		expect(parseRepoName("https://github.com/ReviewStage/stage-cli", FALLBACK_ROOT)).toBe(
			"stage-cli",
		);
	});

	it("extracts the repo name from an ssh:// URL", () => {
		expect(parseRepoName("ssh://git@github.com/ReviewStage/stage-cli.git", FALLBACK_ROOT)).toBe(
			"stage-cli",
		);
	});

	it("falls back to the worktree basename when originUrl is null", () => {
		expect(parseRepoName(null, FALLBACK_ROOT)).toBe("monterrey-v3");
	});

	it("falls back to the worktree basename for an empty/garbage URL", () => {
		expect(parseRepoName("", FALLBACK_ROOT)).toBe("monterrey-v3");
		expect(parseRepoName(".git", FALLBACK_ROOT)).toBe("monterrey-v3");
	});
});

describe("resolveScope", () => {
	it("compares two positional refs through their merge base", async () => {
		const { commonSha, mainSha, featureSha } = await initDivergedRepo();

		const result = resolveScope({ refs: ["main", "feature"] });

		expect(mainSha).not.toBe(featureSha);
		expect(result.scope.kind).toBe(SCOPE_KIND.COMMITTED);
		expect(result.scope.baseSha).toBe(commonSha);
		expect(result.scope.mergeBaseSha).toBe(commonSha);
		expect(result.scope.headSha).toBe(featureSha);
		expect(result.rawDiff).toContain("+feature");
		expect(result.rawDiff).not.toContain("+main");
	});

	it("compares range refs through their merge base", async () => {
		const { commonSha, featureSha } = await initDivergedRepo();

		const result = resolveScope({ refs: ["main..feature"] });

		expect(result.scope.kind).toBe(SCOPE_KIND.COMMITTED);
		expect(result.scope.baseSha).toBe(commonSha);
		expect(result.scope.headSha).toBe(featureSha);
		expect(result.rawDiff).toContain("+feature");
	});

	it("defaults a missing left range ref to HEAD", async () => {
		const { commonSha, featureSha } = await initDivergedRepo();

		const result = resolveScope({ refs: ["..feature"] });

		expect(result.scope.kind).toBe(SCOPE_KIND.COMMITTED);
		expect(result.scope.baseSha).toBe(commonSha);
		expect(result.scope.headSha).toBe(featureSha);
		expect(result.rawDiff).toContain("+feature");
	});

	it("defaults a missing right range ref to HEAD", async () => {
		const { commonSha, mainSha } = await initDivergedRepo();

		const result = resolveScope({ refs: ["feature.."] });

		expect(result.scope.kind).toBe(SCOPE_KIND.COMMITTED);
		expect(result.scope.baseSha).toBe(commonSha);
		expect(result.scope.headSha).toBe(mainSha);
		expect(result.rawDiff).toContain("+main");
	});

	it("compares --base and --compare through their merge base", async () => {
		const { commonSha, featureSha } = await initDivergedRepo();

		const result = resolveScope({ base: "main", compare: "feature" });

		expect(result.scope.kind).toBe(SCOPE_KIND.COMMITTED);
		expect(result.scope.baseSha).toBe(commonSha);
		expect(result.scope.headSha).toBe(featureSha);
	});

	it("prefers a valid branch over a positional working-tree keyword", async () => {
		const { mainSha } = await initDivergedRepo();
		git("checkout", "-b", "staged", "main");
		await writeFile("file.txt", "common\nbranch named staged\n");
		git("commit", "-am", "branch named staged");
		git("checkout", "main");
		await writeFile("file.txt", "common\nmain\nstaged index change\n");
		git("add", "file.txt");
		await writeFile("file.txt", "common\nmain\nstaged index change\nunstaged change\n");

		const result = resolveScope({ refs: ["staged"] });

		expect(result.scope.kind).toBe(SCOPE_KIND.WORKING_TREE);
		if (result.scope.kind !== SCOPE_KIND.WORKING_TREE) {
			throw new Error("Expected working-tree scope");
		}
		expect(result.scope.ref).toBe(WORKING_TREE_REF.WORK);
		expect(result.scope.headSha).toBe(mainSha);
		expect(result.rawDiff).toContain("+unstaged change");
	});
});
