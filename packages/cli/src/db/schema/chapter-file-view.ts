import { index, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { LOCAL_USER_ID } from "../local-user.js";
import { chapter } from "./chapter.js";
import { baseColumns } from "./columns.js";

/**
 * Per-(chapter, file) viewed mark. Inserted when a chapter is marked viewed
 * for every file in its hunkRefs. Mirrors hosted-stage's `chapter_file_view`.
 *
 * The global `file_view` row for a path is only set once *every* chapter in
 * the run that touches that path has a row here — so a file shared across
 * chapters stays unviewed in the Files tab until each chapter has marked it.
 */
export const chapterFileView = sqliteTable(
	"chapter_file_view",
	{
		...baseColumns(),
		userId: text().notNull().default(LOCAL_USER_ID),
		chapterId: text()
			.notNull()
			.references(() => chapter.id, { onDelete: "cascade" }),
		filePath: text().notNull(),
	},
	(table) => [
		unique("chapter_file_view_user_chapter_path_unique").on(
			table.userId,
			table.chapterId,
			table.filePath,
		),
		// Bulk-delete-by-chapter (chapter unmark) is the dominant write pattern,
		// so keep an index on chapterId; the unique constraint above already
		// covers (userId, chapterId, filePath) lookups.
		index("chapter_file_view_chapter_id_idx").on(table.chapterId),
	],
);

export type ChapterFileViewRow = typeof chapterFileView.$inferSelect;
export type ChapterFileViewInsert = typeof chapterFileView.$inferInsert;
