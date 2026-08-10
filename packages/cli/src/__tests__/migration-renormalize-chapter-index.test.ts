import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const RENORMALIZE_TAG = "0008_renormalize_chapter_index";
const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");

interface JournalEntry {
	tag: string;
}
interface Journal {
	entries: JournalEntry[];
}

let tmpDir: string;
let sqlite: Database.Database;

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage-cli-migration-"));
	sqlite = new Database(path.join(tmpDir, "db.sqlite"));
	sqlite.pragma("foreign_keys = ON");
});

afterEach(async () => {
	sqlite.close();
	await fs.rm(tmpDir, { recursive: true, force: true });
});

/** A copy of the migrations folder with every entry from `tag` onward removed. */
async function migrationsFolderBefore(tag: string): Promise<string> {
	const folder = path.join(tmpDir, "migrations");
	await fs.cp(MIGRATIONS_DIR, folder, { recursive: true });
	const journalPath = path.join(folder, "meta", "_journal.json");
	const journal = JSON.parse(await fs.readFile(journalPath, "utf8")) as Journal;
	const cutoff = journal.entries.findIndex((entry) => entry.tag === tag);
	if (cutoff < 0) throw new Error(`Migration ${tag} not found in journal`);
	journal.entries = journal.entries.slice(0, cutoff);
	await fs.writeFile(journalPath, JSON.stringify(journal));
	return folder;
}

function seedRun(runId: string, chapterIndexes: number[]): void {
	const now = Date.now();
	sqlite
		.prepare(
			`INSERT INTO chapter_run (id, createdAt, updatedAt, repoRoot, scopeKind, baseSha, headSha, mergeBaseSha, generatedAt)
			 VALUES (?, ?, ?, '/repo', 'committed', ?, ?, ?, ?)`,
		)
		.run(runId, now, now, "b".repeat(40), "a".repeat(40), "c".repeat(40), now);
	const insertChapter = sqlite.prepare(
		`INSERT INTO chapter (id, createdAt, updatedAt, runId, externalId, chapterIndex, title, summary, hunkRefs)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]')`,
	);
	for (const chapterIndex of chapterIndexes) {
		insertChapter.run(
			randomUUID(),
			now,
			now,
			runId,
			randomUUID().slice(0, 24),
			chapterIndex,
			`Chapter ${chapterIndex}`,
			`Summary ${chapterIndex}`,
		);
	}
}

function indexesByRun(runId: string): Array<{ title: string; chapterIndex: number }> {
	return sqlite
		.prepare("SELECT title, chapterIndex FROM chapter WHERE runId = ? ORDER BY chapterIndex")
		.all(runId) as Array<{ title: string; chapterIndex: number }>;
}

describe("migration 0008 — renormalize chapterIndex", () => {
	it("rewrites legacy 1-based indexes to a dense 0-based rank per run", async () => {
		const db = drizzle(sqlite);
		migrate(db, { migrationsFolder: await migrationsFolderBefore(RENORMALIZE_TAG) });

		// A legacy 1-based run, a sparse legacy run, an already-0-based run, and a
		// run whose insertion (rowid) order differs from its index order.
		seedRun("run-one-based", [1, 2, 3]);
		seedRun("run-sparse", [2, 5]);
		seedRun("run-zero-based", [0, 1]);
		seedRun("run-out-of-order", [3, 1, 2]);

		migrate(db, { migrationsFolder: MIGRATIONS_DIR });

		expect(indexesByRun("run-one-based")).toEqual([
			{ title: "Chapter 1", chapterIndex: 0 },
			{ title: "Chapter 2", chapterIndex: 1 },
			{ title: "Chapter 3", chapterIndex: 2 },
		]);
		expect(indexesByRun("run-sparse")).toEqual([
			{ title: "Chapter 2", chapterIndex: 0 },
			{ title: "Chapter 5", chapterIndex: 1 },
		]);
		expect(indexesByRun("run-zero-based")).toEqual([
			{ title: "Chapter 0", chapterIndex: 0 },
			{ title: "Chapter 1", chapterIndex: 1 },
		]);
		expect(indexesByRun("run-out-of-order")).toEqual([
			{ title: "Chapter 1", chapterIndex: 0 },
			{ title: "Chapter 2", chapterIndex: 1 },
			{ title: "Chapter 3", chapterIndex: 2 },
		]);
	});
});
