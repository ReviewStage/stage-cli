import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { LineRef } from "../../schema.js";
import { chapter } from "./chapter.js";
import { baseColumns } from "./columns.js";

/**
 * Mirrors `~/Developer/stage/packages/db/src/schema/key-change.ts` in sqlite-core syntax.
 * Column shape matches hosted exactly (modulo SQLite encoding for uuid/jsonb/timestamp).
 * `externalId` is the only additive column — the ticket explicitly authorizes it for
 * view-state stability across regenerations (see `chapter.ts` for the ID strategy).
 *
 * Ordering: hosted reads key_changes via Drizzle's relations API without `orderBy`, so
 * rows surface in natural query order (insertion order in practice). We mirror that here
 * — no order/index column, the `runs.ts` route omits `orderBy` for the same reason.
 */
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
