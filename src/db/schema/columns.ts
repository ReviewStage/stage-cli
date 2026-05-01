import { randomUUID } from "node:crypto";
import { integer, text } from "drizzle-orm/sqlite-core";

/**
 * Hosted stage uses Postgres `uuid` PKs and `timestamp` columns. SQLite has no native UUID
 * type, so we store UUIDs as `text` and timestamps as `integer` (Unix ms). The application
 * surface — UUID strings, `Date` objects — matches hosted stage so a future row-sync between
 * the two stores is direct.
 */
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
