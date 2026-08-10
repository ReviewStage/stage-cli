import { sql } from "drizzle-orm";
import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { LOCAL_USER_ID } from "../local-user.js";
import { baseColumns } from "./columns.js";
import { commentThread } from "./comment-thread.js";

// Local (CLI-only) review comments. GitHub review comments are never mirrored
// here — they're fetched live (see the `review` server layer).
export const comment = sqliteTable(
	"comment",
	{
		...baseColumns(),
		threadId: text()
			.notNull()
			.references(() => commentThread.id, { onDelete: "cascade" }),
		authorId: text().notNull().default(LOCAL_USER_ID),
		body: text().notNull(),
	},
	(table) => [index("comment_thread_id_idx").on(table.threadId)],
);

export type CommentRow = typeof comment.$inferSelect;
export type CommentInsert = typeof comment.$inferInsert;

/** Stable insertion order for comments that share the same millisecond timestamp. */
export const commentInsertionOrder = sql<number>`${comment}.rowid`;
