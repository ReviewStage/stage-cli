import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NotInGitRepoError, getRepoRoot } from "../db/path.js";

function expectedPath(repoRoot: string): string {
  const hash = createHash("sha256").update(repoRoot.trim()).digest("hex").slice(0, 12);
  return path.join(os.homedir(), ".stage", hash, "db.sqlite");
}

describe("getDbPath layout", () => {
  it("hashes the same repo root to the same bucket regardless of trailing whitespace", () => {
    expect(expectedPath("/a/repo")).toBe(expectedPath("/a/repo\n"));
    expect(expectedPath("/a/repo")).toBe(expectedPath("  /a/repo  "));
  });

  it("hashes different repo roots to distinct buckets", () => {
    expect(expectedPath("/a/repo")).not.toBe(expectedPath("/b/repo"));
  });

  it("places the database under ~/.stage/<hash>/db.sqlite", () => {
    const p = expectedPath("/sample/repo");
    expect(p.startsWith(path.join(os.homedir(), ".stage"))).toBe(true);
    expect(path.basename(p)).toBe("db.sqlite");
  });
});

describe("getRepoRoot outside a git repo", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage-cli-no-git-"));
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("throws NotInGitRepoError instead of silently falling back to cwd", () => {
    expect(() => getRepoRoot()).toThrow(NotInGitRepoError);
  });
});
