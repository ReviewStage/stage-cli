import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { LineRef } from "../../schema.js";
import { chapter } from "./chapter.js";
import { baseColumns } from "./columns.js";

export const keyChange = sqliteTable(
  "key_change",
  {
    ...baseColumns(),
    chapterId: text()
      .notNull()
      .references(() => chapter.id, { onDelete: "cascade" }),
    externalId: text().notNull(),
    content: text().notNull(),
    lineRefs: text({ mode: "json" }).$type<LineRef[]>().notNull().default([]),
  },
  (table) => [index("key_change_chapter_id_idx").on(table.chapterId)],
);

export type KeyChangeRow = typeof keyChange.$inferSelect;
export type KeyChangeInsert = typeof keyChange.$inferInsert;
