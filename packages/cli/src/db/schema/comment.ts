import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { LOCAL_USER_ID } from "../local-user.js";
import { baseColumns } from "./columns.js";
import { commentThread } from "./comment-thread.js";

export const comment = sqliteTable(
	"comment",
	{
		...baseColumns(),
		threadId: text()
			.notNull()
			.references(() => commentThread.id, { onDelete: "cascade" }),
		/** `local` for comments authored in the CLI; the GitHub login for pulled comments. */
		authorId: text().notNull().default(LOCAL_USER_ID),
		/** Avatar for non-local authors (pulled GitHub comments); null for the local user. */
		authorAvatarUrl: text(),
		body: text().notNull(),
		/**
		 * GitHub review-comment database id once the comment is synced — set when a
		 * comment is pulled from the PR or after a local comment is pushed to it.
		 * Null marks a comment as local-only and not yet on GitHub. It's the dedup
		 * key for both directions, so re-syncing never duplicates a comment.
		 */
		githubCommentId: integer({ mode: "number" }),
	},
	(table) => [
		index("comment_thread_id_idx").on(table.threadId),
		uniqueIndex("comment_github_comment_id_idx").on(table.githubCommentId),
	],
);

export type CommentRow = typeof comment.$inferSelect;
export type CommentInsert = typeof comment.$inferInsert;
