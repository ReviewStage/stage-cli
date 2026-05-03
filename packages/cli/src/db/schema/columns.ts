import { randomUUID } from "node:crypto";
import { integer, text } from "drizzle-orm/sqlite-core";

export function baseColumns() {
	return {
		id: text()
			.primaryKey()
			.$defaultFn(() => randomUUID()),
		createdAt: integer({ mode: "timestamp_ms" })
			.$defaultFn(() => new Date())
			.notNull(),
		updatedAt: integer({ mode: "timestamp_ms" })
			.$defaultFn(() => new Date())
			.$onUpdateFn(() => new Date())
			.notNull(),
	};
}
