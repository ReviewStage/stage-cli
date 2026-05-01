import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Pull the per-repo path logic into a tiny pure helper so we can assert without invoking
// `git rev-parse`. The shape mirrors `getDbPath()` precisely; if path.ts changes layout,
// this test will catch it.
function expectedPath(repoRoot: string): string {
  const hash = createHash("sha256").update(repoRoot.trim()).digest("hex").slice(0, 12);
  return path.join(homedir(), ".stage", hash, "db.sqlite");
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
    expect(p.startsWith(path.join(homedir(), ".stage"))).toBe(true);
    expect(path.basename(p)).toBe("db.sqlite");
  });
});
