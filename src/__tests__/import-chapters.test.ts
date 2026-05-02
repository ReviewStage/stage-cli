import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../db/client.js";
import { chapter, chapterRun, keyChange } from "../db/schema/index.js";
import { importChaptersFile, insertChaptersFile } from "../runs/import-chapters.js";
import { makeFixture } from "./fixtures.js";

let tmpDir: string;
let dbPath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage-cli-import-"));
  dbPath = path.join(tmpDir, "db.sqlite");
  closeDb();
});

afterEach(async () => {
  closeDb();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("chapter import", () => {
  it("inserts a run, chapters, and key_changes atomically and returns the runId", async () => {
    const db = getDb({ dbPath });
    const fixture = makeFixture();
    const fixturePath = path.join(tmpDir, "chapters.json");
    await fs.writeFile(fixturePath, JSON.stringify(fixture));

    const result = importChaptersFile(fixturePath, db);

    expect(result.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.chapterCount).toBe(1);
    expect(result.keyChangeCount).toBe(1);

    const runs = db.select().from(chapterRun).all();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.scopeKind).toBe("committed");
    expect(runs[0]?.workingTreeRef).toBeNull();
    expect(runs[0]?.headSha).toBe(fixture.scope.headSha);

    const chapters = db.select().from(chapter).all();
    expect(chapters).toHaveLength(1);
    expect(chapters[0]?.runId).toBe(result.runId);
    expect(chapters[0]?.externalId).toMatch(/^[0-9a-f]{24}$/);
    expect(chapters[0]?.chapterIndex).toBe(1);
    expect(chapters[0]?.hunkRefs).toEqual([{ filePath: "src/foo.ts", oldStart: 1 }]);

    const keyChanges = db.select().from(keyChange).all();
    expect(keyChanges).toHaveLength(1);
    expect(keyChanges[0]?.chapterId).toBe(chapters[0]?.id);
    expect(keyChanges[0]?.content).toContain("primary org");
    expect(keyChanges[0]?.lineRefs).toEqual([
      { filePath: "src/foo.ts", side: "additions", startLine: 5, endLine: 10 },
    ]);
  });

  it("creates a new run when importing identical content again (history preserved)", () => {
    const db = getDb({ dbPath });
    const fixture = makeFixture();

    const first = insertChaptersFile(db, fixture, "/repo");
    const second = insertChaptersFile(db, fixture, "/repo");

    expect(first.runId).not.toBe(second.runId);
    expect(db.select().from(chapterRun).all()).toHaveLength(2);
    expect(db.select().from(chapter).all()).toHaveLength(2);
  });

  it("derives stable externalIds for key_changes across repeated imports of the same scope", () => {
    const db = getDb({ dbPath });
    const fixture = makeFixture();

    insertChaptersFile(db, fixture, "/repo");
    insertChaptersFile(db, fixture, "/repo");

    const all = db.select().from(keyChange).all();
    expect(all).toHaveLength(2);
    expect(all[0]?.externalId).toBe(all[1]?.externalId);
  });

  it("derives stable chapter externalIds across repeated imports of the same scope", () => {
    const db = getDb({ dbPath });
    insertChaptersFile(db, makeFixture(), "/repo");
    insertChaptersFile(db, makeFixture(), "/repo");

    const all = db.select().from(chapter).all();
    expect(all).toHaveLength(2);
    expect(all[0]?.externalId).toBe(all[1]?.externalId);
  });

  it("scopes externalIds — different headShas with same agent id produce different externalIds", () => {
    const db = getDb({ dbPath });
    const scopeA = {
      kind: "committed" as const,
      baseSha: "1".repeat(40),
      headSha: "2".repeat(40),
      mergeBaseSha: "3".repeat(40),
    };
    const scopeB = { ...scopeA, headSha: "4".repeat(40) };

    insertChaptersFile(db, makeFixture({ scope: scopeA }), "/repo");
    insertChaptersFile(db, makeFixture({ scope: scopeB }), "/repo");

    const chapters = db.select().from(chapter).all();
    expect(chapters).toHaveLength(2);
    expect(chapters[0]?.externalId).not.toBe(chapters[1]?.externalId);

    const keyChanges = db.select().from(keyChange).all();
    expect(keyChanges).toHaveLength(2);
    expect(keyChanges[0]?.externalId).not.toBe(keyChanges[1]?.externalId);
  });

  it("scopes externalIds — committed vs workingTree of the same SHAs produce different externalIds", () => {
    const db = getDb({ dbPath });
    const shas = {
      baseSha: "1".repeat(40),
      headSha: "2".repeat(40),
      mergeBaseSha: "3".repeat(40),
    };

    insertChaptersFile(db, makeFixture({ scope: { kind: "committed", ...shas } }), "/repo");
    insertChaptersFile(
      db,
      makeFixture({ scope: { kind: "workingTree", ref: "work", ...shas } }),
      "/repo",
    );

    const chapters = db.select().from(chapter).all();
    expect(chapters).toHaveLength(2);
    expect(chapters[0]?.externalId).not.toBe(chapters[1]?.externalId);
  });

  it("preserves the workingTree scope discriminator", () => {
    const db = getDb({ dbPath });
    insertChaptersFile(
      db,
      makeFixture({
        scope: {
          kind: "workingTree",
          ref: "staged",
          baseSha: "1".repeat(40),
          headSha: "2".repeat(40),
          mergeBaseSha: "3".repeat(40),
        },
      }),
      "/repo",
    );

    const [row] = db.select().from(chapterRun).all();
    expect(row?.scopeKind).toBe("workingTree");
    expect(row?.workingTreeRef).toBe("staged");
  });

  it("rejects invalid JSON without writing partial state", async () => {
    const db = getDb({ dbPath });
    const bad = path.join(tmpDir, "bad.json");
    await fs.writeFile(
      bad,
      JSON.stringify({
        scope: { kind: "committed", baseSha: "nope", headSha: "nope", mergeBaseSha: "nope" },
        chapters: [],
        generatedAt: "yesterday",
      }),
    );

    expect(() => importChaptersFile(bad, db)).toThrow();
    expect(db.select().from(chapterRun).all()).toHaveLength(0);
    expect(db.select().from(chapter).all()).toHaveLength(0);
  });

  it("runs migrations idempotently across reopens", () => {
    const db1 = getDb({ dbPath });
    insertChaptersFile(db1, makeFixture(), "/repo");
    closeDb();

    const db2 = getDb({ dbPath });
    expect(db2.select().from(chapterRun).all()).toHaveLength(1);
    insertChaptersFile(db2, makeFixture(), "/repo");
    expect(db2.select().from(chapterRun).all()).toHaveLength(2);
  });

  it("uses isolated databases for distinct dbPaths", async () => {
    const dbPathA = path.join(tmpDir, "a.sqlite");
    const dbPathB = path.join(tmpDir, "b.sqlite");

    const dbA = getDb({ dbPath: dbPathA });
    insertChaptersFile(dbA, makeFixture(), "/repo-a");
    closeDb();

    const dbB = getDb({ dbPath: dbPathB });
    expect(dbB.select().from(chapterRun).all()).toHaveLength(0);
  });
});
