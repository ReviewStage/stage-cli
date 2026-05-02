import { sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { LOCAL_USER_ID } from "../local-user.js";
import { chapter } from "./chapter.js";
import { baseColumns } from "./columns.js";

export const chapterView = sqliteTable(
  "chapter_view",
  {
    ...baseColumns(),
    userId: text().notNull().default(LOCAL_USER_ID),
    chapterId: text()
      .notNull()
      .references(() => chapter.id, { onDelete: "cascade" }),
  },
  (table) => [unique("chapter_view_user_chapter_unique").on(table.userId, table.chapterId)],
);

export type ChapterViewRow = typeof chapterView.$inferSelect;
export type ChapterViewInsert = typeof chapterView.$inferInsert;
