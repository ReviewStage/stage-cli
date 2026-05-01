import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { LineRef } from "../../schema.js";
import { chapter } from "./chapter.js";
import { baseColumns } from "./columns.js";

/**
 * Mirrors `~/Developer/stage/packages/db/src/schema/key-change.ts` in sqlite-core syntax.
 * `externalId` is content-derived (see `chapter.ts` for the ID strategy).
 *
 * `keyChangeIndex` is additive vs hosted stage: SQLite's millisecond `Date` resolution
 * collides for rows inserted in the same `ingest` transaction, so we can't rely on
 * `createdAt` for stable UI ordering. Mirrors the role of `chapter.chapterIndex`.
 */
export const keyChange = sqliteTable(
  "key_change",
  {
    ...baseColumns(),
    chapterId: text()
      .notNull()
      .references(() => chapter.id, { onDelete: "cascade" }),
    externalId: text().notNull(),
    keyChangeIndex: integer().notNull(),
    content: text().notNull(),
    lineRefs: text({ mode: "json" }).$type<LineRef[]>().notNull().default([]),
  },
  (table) => [index("key_change_chapter_id_idx").on(table.chapterId)],
);

export type KeyChangeRow = typeof keyChange.$inferSelect;
export type KeyChangeInsert = typeof keyChange.$inferInsert;
