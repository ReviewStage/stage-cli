import { index, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { LOCAL_USER_ID } from "../local-user.js";
import { baseColumns } from "./columns.js";
import { keyChange } from "./key-change.js";

export const keyChangeView = sqliteTable(
  "key_change_view",
  {
    ...baseColumns(),
    userId: text().notNull().default(LOCAL_USER_ID),
    keyChangeId: text()
      .notNull()
      .references(() => keyChange.id, { onDelete: "cascade" }),
  },
  (table) => [
    unique("key_change_view_user_key_change_unique").on(table.userId, table.keyChangeId),
    index("key_change_view_key_change_id_idx").on(table.keyChangeId),
  ],
);

export type KeyChangeViewRow = typeof keyChangeView.$inferSelect;
export type KeyChangeViewInsert = typeof keyChangeView.$inferInsert;
