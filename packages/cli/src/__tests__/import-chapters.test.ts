import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../db/client.js";
import { chapter, chapterRun, keyChange } from "../db/schema/index.js";
import { importChaptersFile, insertChaptersFile } from "../runs/import-chapters.js";
import { makeFixture, makeRepoContext } from "./fixtures.js";

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
		expect(chapters[0]?.chapterIndex).toBe(0);
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

		const first = insertChaptersFile(db, fixture, makeRepoContext());
		const second = insertChaptersFile(db, fixture, makeRepoContext());

		expect(first.runId).not.toBe(second.runId);
		expect(db.select().from(chapterRun).all()).toHaveLength(2);
		expect(db.select().from(chapter).all()).toHaveLength(2);
	});

	it("derives stable externalIds for key_changes across repeated imports of the same scope", () => {
		const db = getDb({ dbPath });
		const fixture = makeFixture();

		insertChaptersFile(db, fixture, makeRepoContext());
		insertChaptersFile(db, fixture, makeRepoContext());

		const all = db.select().from(keyChange).all();
		expect(all).toHaveLength(2);
		expect(all[0]?.externalId).toBe(all[1]?.externalId);
	});

	it("derives stable chapter externalIds across repeated imports of the same scope", () => {
		const db = getDb({ dbPath });
		insertChaptersFile(db, makeFixture(), makeRepoContext());
		insertChaptersFile(db, makeFixture(), makeRepoContext());

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

		insertChaptersFile(db, makeFixture({ scope: scopeA }), makeRepoContext());
		insertChaptersFile(db, makeFixture({ scope: scopeB }), makeRepoContext());

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

		insertChaptersFile(
			db,
			makeFixture({ scope: { kind: "committed", ...shas } }),
			makeRepoContext(),
		);
		insertChaptersFile(
			db,
			makeFixture({ scope: { kind: "workingTree", ref: "work", ...shas } }),
			makeRepoContext(),
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
			makeRepoContext(),
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
		insertChaptersFile(db1, makeFixture(), makeRepoContext());
		closeDb();

		const db2 = getDb({ dbPath });
		expect(db2.select().from(chapterRun).all()).toHaveLength(1);
		insertChaptersFile(db2, makeFixture(), makeRepoContext());
		expect(db2.select().from(chapterRun).all()).toHaveLength(2);
	});

	it("stores the prologue on chapter_run when present", () => {
		const db = getDb({ dbPath });
		const prologue = {
			motivation: "Dashboards would break during deploys.",
			rootCause: "Deploys evicted the cache before dashboards could re-render.",
			outcome: "Dashboards stay up during deploys now.",
			diagram: "graph LR;\n  Deploy-->Cache-->Dashboard",
			keyChanges: [
				{
					summary: "Deploy-safe dashboard rendering",
					description: "Uses cached data during deploys",
				},
			],
			focusAreas: [
				{
					type: "architecture" as const,
					severity: "info" as const,
					title: "New caching layer",
					description: "Confirm cache invalidation on deploy completion",
					locations: ["src/dashboard.ts"],
				},
			],
			complexity: { level: "medium" as const, reasoning: "Touches caching and rendering" },
		};

		insertChaptersFile(db, makeFixture({ prologue }), makeRepoContext());

		const [row] = db.select().from(chapterRun).all();
		expect(row?.prologue).toEqual(prologue);
	});

	it("stores null prologue when omitted from the fixture", () => {
		const db = getDb({ dbPath });
		insertChaptersFile(db, makeFixture(), makeRepoContext());

		const [row] = db.select().from(chapterRun).all();
		expect(row?.prologue).toBeNull();
	});

	it("sorts chapters by order and assigns a dense 0-based chapterIndex", () => {
		const db = getDb({ dbPath });
		const chapterOver = (id: string, order: number) => ({
			id,
			order,
			title: `Chapter ${id}`,
			summary: `Summary for ${id}`,
			hunkRefs: [],
			keyChanges: [],
		});
		insertChaptersFile(
			db,
			makeFixture({
				chapters: [chapterOver("chapter-b", 5), chapterOver("chapter-a", 2)],
			}),
			makeRepoContext(),
		);

		const rows = db.select().from(chapter).all();
		expect(rows.map((r) => [r.title, r.chapterIndex])).toEqual([
			["Chapter chapter-a", 0],
			["Chapter chapter-b", 1],
		]);
	});

	it("survives duplicate agent-supplied orders (unique runId+chapterIndex)", () => {
		const db = getDb({ dbPath });
		const chapterOver = (id: string) => ({
			id,
			order: 1,
			title: `Chapter ${id}`,
			summary: `Summary for ${id}`,
			hunkRefs: [],
			keyChanges: [],
		});
		insertChaptersFile(
			db,
			makeFixture({ chapters: [chapterOver("chapter-a"), chapterOver("chapter-b")] }),
			makeRepoContext(),
		);

		const rows = db.select().from(chapter).all();
		expect(rows.map((r) => r.chapterIndex).sort()).toEqual([0, 1]);
	});

	it("persists riskLevel and stores riskReasons null when empty", () => {
		const db = getDb({ dbPath });
		const fixture = makeFixture();
		const first = fixture.chapters[0];
		if (!first) throw new Error("fixture missing chapter");
		first.riskLevel = "high";
		first.riskReasons = ["Alters auth token handling"];
		insertChaptersFile(db, fixture, makeRepoContext());

		insertChaptersFile(db, makeFixture(), makeRepoContext());

		const rows = db.select().from(chapter).all();
		expect(rows[0]?.riskLevel).toBe("high");
		expect(rows[0]?.riskReasons).toEqual(["Alters auth token handling"]);
		expect(rows[1]?.riskLevel).toBeNull();
		expect(rows[1]?.riskReasons).toBeNull();
	});

	it("uses isolated databases for distinct dbPaths", async () => {
		const dbPathA = path.join(tmpDir, "a.sqlite");
		const dbPathB = path.join(tmpDir, "b.sqlite");

		const dbA = getDb({ dbPath: dbPathA });
		insertChaptersFile(dbA, makeFixture(), makeRepoContext({ root: "/repo-a" }));
		closeDb();

		const dbB = getDb({ dbPath: dbPathB });
		expect(dbB.select().from(chapterRun).all()).toHaveLength(0);
	});
});
