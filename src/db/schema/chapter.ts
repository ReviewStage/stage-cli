import { integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import type { HunkReference } from "../../schema.js";
import { chapterRun } from "./chapter-run.js";
import { baseColumns } from "./columns.js";

/**
 * Mirrors `~/Developer/stage/packages/db/src/schema/chapter.ts` in sqlite-core syntax —
 * column names match exactly so a future row-sync to hosted stage is direct. The only
 * conversion is `jsonb` → `text({ mode: 'json' })`.
 *
 * # ID strategy (single source of truth — referenced by view-state schemas in PLA-117)
 *
 * - `id` is a UUID PK matching hosted stage's `chapter.id` shape.
 * - `externalId` is a content-derived string from the agent's chapters JSON (the Zod
 *   schema's `chapter.id`). It's stable across re-ingests of the same diff content, so
 *   view-state (chapter_view, key_change_view) can survive regenerations by joining on
 *   `externalId` instead of the per-run UUID PK.
 *
 * The view-state API translates between externalId (what the SPA holds) and the UUID PK
 * (what the FK chain uses) at the boundary.
 */
export const chapter = sqliteTable(
  "chapter",
  {
    ...baseColumns(),
    runId: text()
      .notNull()
      .references(() => chapterRun.id, { onDelete: "cascade" }),
    externalId: text().notNull(),
    chapterIndex: integer().notNull(),
    title: text().notNull(),
    summary: text().notNull(),
    hunkRefs: text({ mode: "json" }).$type<HunkReference[]>().notNull(),
    keyChanges: text({ mode: "json" }).$type<string[]>().notNull().default([]),
  },
  (table) => [unique("chapter_run_idx_unique").on(table.runId, table.chapterIndex)],
);

export type ChapterRow = typeof chapter.$inferSelect;
export type ChapterInsert = typeof chapter.$inferInsert;
