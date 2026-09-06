import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const AUTHOR_TYPE_TAG = "0008_wakeful_roxanne_simpson";
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

function seedLegacyComment(threadId: string, commentId: string): void {
	const now = Date.now();
	sqlite
		.prepare(
			`INSERT INTO comment_thread (id, createdAt, updatedAt, scopeKey, filePath, side, startLine, endLine)
			 VALUES (?, ?, ?, 'committed:a:b:c', 'src/foo.ts', 'additions', 1, 1)`,
		)
		.run(threadId, now, now);
	sqlite
		.prepare(
			`INSERT INTO comment (id, createdAt, updatedAt, threadId, authorId, body)
			 VALUES (?, ?, ?, ?, 'local', 'Legacy comment')`,
		)
		.run(commentId, now, now, threadId);
}

describe("migration 0008 — comment.authorType", () => {
	it("backfills existing comments as user-authored and keeps them readable", async () => {
		const db = drizzle(sqlite);
		migrate(db, { migrationsFolder: await migrationsFolderBefore(AUTHOR_TYPE_TAG) });
		const threadId = randomUUID();
		const commentId = randomUUID();
		seedLegacyComment(threadId, commentId);

		migrate(db, { migrationsFolder: MIGRATIONS_DIR });

		const row = sqlite
			.prepare("SELECT authorType, body FROM comment WHERE id = ?")
			.get(commentId) as { authorType: string; body: string };
		expect(row).toEqual({ authorType: "user", body: "Legacy comment" });
	});
});
