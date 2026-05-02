import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getDbPath } from "./path.js";
import * as schema from "./schema/index.js";

export type StageDb = BetterSQLite3Database<typeof schema>;

interface CachedHandle {
	sqlite: Database.Database;
	drizzle: StageDb;
	path: string;
}

let cached: CachedHandle | null = null;

export function getDb(opts: { dbPath?: string } = {}): StageDb {
	const dbPath = opts.dbPath ?? getDbPath();
	if (cached && cached.path === dbPath) return cached.drizzle;
	if (cached) closeDb();

	const sqlite = new Database(dbPath);
	sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("foreign_keys = ON");

	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: findMigrationsFolder() });

	cached = { sqlite, drizzle: db, path: dbPath };
	return db;
}

export function closeDb(): void {
	if (!cached) return;
	cached.sqlite.close();
	cached = null;
}

// Module depth differs between dev (src/db/client.ts) and prod (bundled dist/index.js),
// so walk up from the running module to find the package's drizzle/ folder.
function findMigrationsFolder(): string {
	let dir = path.dirname(fileURLToPath(import.meta.url));
	for (let i = 0; i < 10; i++) {
		const candidate = path.join(dir, "drizzle");
		if (existsSync(path.join(candidate, "meta", "_journal.json"))) return candidate;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	throw new Error("Could not locate drizzle migrations folder");
}
