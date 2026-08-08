import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { DIFF_SIDE } from "../../schema.js";
import { baseColumns } from "./columns.js";

export const commentThread = sqliteTable(
	"comment_thread",
	{
		...baseColumns(),
		// Repository checkout that owns this thread. Scope SHAs alone are not unique
		// across upstream repositories and forks that share commit history.
		repoRoot: text().notNull(),
		// Anchors the thread to a diff scope rather than a single run, so comments
		// survive re-imports of the same diff (mirrors how external_id keys view-state).
		scopeKey: text().notNull(),
		filePath: text().notNull(),
		side: text({ enum: [DIFF_SIDE.ADDITIONS, DIFF_SIDE.DELETIONS] }).notNull(),
		startLine: integer().notNull(),
		endLine: integer().notNull(),
		/** Null while open; set to the resolution time once resolved. */
		resolvedAt: integer({ mode: "timestamp_ms" }),
	},
	(table) => [index("comment_thread_repo_scope_idx").on(table.repoRoot, table.scopeKey)],
);

export type CommentThreadRow = typeof commentThread.$inferSelect;
export type CommentThreadInsert = typeof commentThread.$inferInsert;
