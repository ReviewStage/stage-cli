import type { Prologue } from "@stage-cli/types/prologue";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { SCOPE_KIND, WORKING_TREE_REF } from "../../schema.js";
import { baseColumns } from "./columns.js";

export const chapterRun = sqliteTable(
	"chapter_run",
	{
		...baseColumns(),
		repoRoot: text().notNull(),
		originUrl: text(),
		scopeKind: text({ enum: [SCOPE_KIND.COMMITTED, SCOPE_KIND.WORKING_TREE] }).notNull(),
		workingTreeRef: text({
			enum: [WORKING_TREE_REF.WORK, WORKING_TREE_REF.STAGED, WORKING_TREE_REF.UNSTAGED],
		}),
		baseSha: text().notNull(),
		headSha: text().notNull(),
		mergeBaseSha: text().notNull(),
		generatedAt: integer({ mode: "timestamp_ms" }).notNull(),
		prologue: text({ mode: "json" }).$type<Prologue>(),
	},
	(table) => [index("chapter_run_created_at_idx").on(table.createdAt)],
);

export type ChapterRunRow = typeof chapterRun.$inferSelect;
export type ChapterRunInsert = typeof chapterRun.$inferInsert;
