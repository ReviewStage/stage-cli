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
		/** Pull request that owns an interrupted local-to-remote promotion. */
		promotionPullRequestNodeId: text(),
		/** GitHub thread created by an interrupted local-to-remote promotion. */
		promotionThreadNodeId: text(),
		/** Root comment used to roll back an interrupted promotion safely. */
		promotionRootCommentNodeId: text(),
		/** GitHub viewer that created the interrupted promotion. */
		promotionViewerLogin: text(),
		/** Number of local replies already copied to the promotion thread. */
		promotionReplyCount: integer().notNull().default(0),
		/** GitHub node ids for copied replies, in local reply order. */
		promotionReplyNodeIds: text({ mode: "json" }).$type<(string | null)[]>().notNull().default([]),
	},
	(table) => [index("comment_thread_repo_scope_idx").on(table.repoRoot, table.scopeKey)],
);

export type CommentThreadRow = typeof commentThread.$inferSelect;
export type CommentThreadInsert = typeof commentThread.$inferInsert;
