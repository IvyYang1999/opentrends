import { relations, sql } from "drizzle-orm";
import {
	integer,
	primaryKey,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";

import { user } from "./auth";

const now = sql`(unixepoch())`;

export const userTrendsPreference = sqliteTable(
	"user_trends_preference",
	{
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		topicId: text("topic_id").notNull(),
		orderedSourceIds: text("ordered_source_ids").notNull(),
		hiddenSourceIds: text("hidden_source_ids").notNull(),
		pinnedSourceIds: text("pinned_source_ids").notNull().default("[]"),
		createdAt: integer("created_at", { mode: "timestamp" })
			.default(now)
			.notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp" })
			.default(now)
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [primaryKey({ columns: [table.userId, table.topicId] })]
);

export const userTrendsPreferenceRelations = relations(
	userTrendsPreference,
	({ one }) => ({
		user: one(user, {
			fields: [userTrendsPreference.userId],
			references: [user.id],
		}),
	})
);
