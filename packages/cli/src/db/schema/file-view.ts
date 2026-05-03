import { sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { LOCAL_USER_ID } from "../local-user.js";
import { chapterRun } from "./chapter-run.js";
import { baseColumns } from "./columns.js";

export const fileView = sqliteTable(
	"file_view",
	{
		...baseColumns(),
		userId: text().notNull().default(LOCAL_USER_ID),
		runId: text()
			.notNull()
			.references(() => chapterRun.id, { onDelete: "cascade" }),
		filePath: text().notNull(),
	},
	(table) => [
		unique("file_view_user_run_path_unique").on(table.userId, table.runId, table.filePath),
	],
);

export type FileViewRow = typeof fileView.$inferSelect;
export type FileViewInsert = typeof fileView.$inferInsert;
