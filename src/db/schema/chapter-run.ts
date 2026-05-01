import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { SCOPE_KIND, WORKING_TREE_REF } from "../../schema.js";
import { baseColumns } from "./columns.js";

/**
 * One row per `stage-cli ingest` invocation. Re-ingesting the same scope produces a new
 * row — history is preserved, never overwritten.
 *
 * Mirrors the discriminated `scope` shape from the Zod `ChaptersFile` schema (PLA-104).
 * `workingTreeRef` is nullable; populated only when `scopeKind === 'workingTree'`.
 *
 * Hosted stage's `chapter_run` is keyed by `(pullRequestId, headSha, runIndex)`. Stage CLI
 * has no pull_request concept yet, so we key only by `id` and let the agent ingest as many
 * runs as it likes per repo.
 */
export const chapterRun = sqliteTable(
  "chapter_run",
  {
    ...baseColumns(),
    repoRoot: text().notNull(),
    scopeKind: text({ enum: [SCOPE_KIND.COMMITTED, SCOPE_KIND.WORKING_TREE] }).notNull(),
    workingTreeRef: text({
      enum: [WORKING_TREE_REF.WORK, WORKING_TREE_REF.STAGED, WORKING_TREE_REF.UNSTAGED],
    }),
    baseSha: text().notNull(),
    headSha: text().notNull(),
    mergeBaseSha: text().notNull(),
    generatedAt: integer({ mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("chapter_run_created_at_idx").on(table.createdAt)],
);

export type ChapterRunRow = typeof chapterRun.$inferSelect;
export type ChapterRunInsert = typeof chapterRun.$inferInsert;
