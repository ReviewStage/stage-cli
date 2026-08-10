import { integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import type { HunkReference } from "../../schema.js";
import { RISK_LEVEL } from "../../schema.js";
import { chapterRun } from "./chapter-run.js";
import { baseColumns } from "./columns.js";

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
		riskLevel: text({ enum: [RISK_LEVEL.HIGH, RISK_LEVEL.MEDIUM, RISK_LEVEL.LOW] }),
		riskReasons: text({ mode: "json" }).$type<string[]>(),
	},
	(table) => [unique("chapter_run_idx_unique").on(table.runId, table.chapterIndex)],
);

export type ChapterRow = typeof chapter.$inferSelect;
export type ChapterInsert = typeof chapter.$inferInsert;
