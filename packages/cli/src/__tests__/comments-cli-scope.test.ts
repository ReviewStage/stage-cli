import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveCommentScopeKey } from "../comments/comments-cli.js";
import { closeDb, getDb } from "../db/client.js";
import { chapterRun } from "../db/schema/index.js";
import { insertChaptersFile } from "../runs/import-chapters.js";
import { deriveScopeKey } from "../runs/scope-key.js";
import { type DiffScopeOptions, resolveDiffScope } from "../scope.js";
import { makeFixture, makeRepoContext } from "./fixtures.js";

let tmpDir: string;
let originalCwd: string;

beforeEach(async () => {
	originalCwd = process.cwd();
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage-cli-comments-scope-"));
	closeDb();
});

afterEach(async () => {
	process.chdir(originalCwd);
	closeDb();
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

/** main with one commit, plus a feature branch (checked out) with one more commit. */
async function initFeatureBranchRepo(): Promise<void> {
	git("init", "--initial-branch=main");
	git("config", "user.email", "test@example.com");
	git("config", "user.name", "Test");
	git("config", "commit.gpgsign", "false");
	await writeFile("file.txt", "base\n");
	git("add", "file.txt");
	git("commit", "-m", "base");
	git("checkout", "-b", "feature");
	await writeFile("file.txt", "base\nfeature\n");
	git("commit", "-am", "feature change");
	process.chdir(tmpDir);
}

/**
 * The scope key `show` would store for these options: resolve the scope the same
 * way `show` does, import a chapters file carrying it, and read the run back.
 */
async function scopeKeyShowWouldStore(options: DiffScopeOptions): Promise<string> {
	const { scope } = await resolveDiffScope(options);
	const db = getDb({ dbPath: path.join(tmpDir, "db.sqlite") });
	const { runId } = insertChaptersFile(db, makeFixture({ scope }), makeRepoContext());
	const run = await db.query.chapterRun.findFirst({ where: eq(chapterRun.id, runId) });
	if (!run) throw new Error("run not inserted");
	return deriveScopeKey(run);
}

describe("comments CLI — scope resolution parity with show", () => {
	it("targets the committed scope show uses for a clean feature branch", async () => {
		await initFeatureBranchRepo();

		const scopeKey = await resolveCommentScopeKey({});

		expect(scopeKey).toMatch(/^committed:/);
		expect(scopeKey).toBe(await scopeKeyShowWouldStore({}));
	});

	it("targets the working-tree scope show uses when changes are uncommitted", async () => {
		await initFeatureBranchRepo();
		await writeFile("file.txt", "base\nfeature\nwip\n");

		const scopeKey = await resolveCommentScopeKey({});

		expect(scopeKey).toMatch(/^workingTree:work:/);
		expect(scopeKey).toBe(await scopeKeyShowWouldStore({}));
	});

	it("honours explicit --ref and --base/--compare selectors like show", async () => {
		await initFeatureBranchRepo();
		await writeFile("file.txt", "base\nfeature\nstaged\n");
		git("add", "file.txt");

		const staged = { workingTreeRef: "staged" } as const;
		expect(await resolveCommentScopeKey(staged)).toMatch(/^workingTree:staged:/);
		expect(await resolveCommentScopeKey(staged)).toBe(await scopeKeyShowWouldStore(staged));

		const comparison = { base: "main", compare: "feature" };
		expect(await resolveCommentScopeKey(comparison)).toBe(await scopeKeyShowWouldStore(comparison));
	});
});
