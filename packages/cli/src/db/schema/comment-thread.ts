import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { DIFF_SIDE } from "../../schema.js";
import { baseColumns } from "./columns.js";

export const commentThread = sqliteTable(
	"comment_thread",
	{
		...baseColumns(),
		// Anchors the thread to a diff scope rather than a single run, so comments
		// survive re-imports of the same diff (mirrors how external_id keys view-state).
		scopeKey: text().notNull(),
		filePath: text().notNull(),
		side: text({ enum: [DIFF_SIDE.ADDITIONS, DIFF_SIDE.DELETIONS] }).notNull(),
		startLine: integer().notNull(),
		endLine: integer().notNull(),
		/** Null while open; set to the resolution time once resolved. */
		resolvedAt: integer({ mode: "timestamp_ms" }),
		/**
		 * Null = a local note. Set = a pending review comment destined for this PR;
		 * it is deleted once the review is submitted (GitHub becomes the source of
		 * truth). Lives on the thread (not the run) because scopeKey survives
		 * re-imports and is shared between PR and non-PR runs of the same diff.
		 */
		prNumber: integer(),
	},
	(table) => [index("comment_thread_scope_key_idx").on(table.scopeKey)],
);

export type CommentThreadRow = typeof commentThread.$inferSelect;
export type CommentThreadInsert = typeof commentThread.$inferInsert;
