import {
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

export const source = pgTable("source", {
	sourceId: text("source_id").primaryKey(),
	status: text("status").default("error").notNull(),
	generation: integer("generation").default(0).notNull(),
	fetchedAt: timestamp("fetched_at", { withTimezone: true }),
	lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
	expiresAt: timestamp("expires_at", { withTimezone: true }),
	staleUntil: timestamp("stale_until", { withTimezone: true }),
	itemCount: integer("item_count").default(0).notNull(),
	errorCount: integer("error_count").default(0).notNull(),
	lastError: text("last_error"),
	refreshOwner: text("refresh_owner"),
	refreshLockedUntil: timestamp("refresh_locked_until", {
		withTimezone: true,
	}),
	createdAt: timestamp("created_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
});

export const sourceItem = pgTable(
	"source_item",
	{
		sourceId: text("source_id").notNull(),
		itemId: text("item_id").notNull(),
		generation: integer("generation").notNull(),
		url: text("url").notNull(),
		title: text("title").notNull(),
		description: text("description"),
		imageUrl: text("image_url"),
		rank: integer("rank").notNull(),
		publishedAt: timestamp("published_at", { withTimezone: true }),
		fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
		lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
		contentHash: text("content_hash").notNull(),
		hotValue: jsonb("hot_value").$type<string | number | null>(),
		original: jsonb("original").$type<{
			description?: string;
			title: string;
		} | null>(),
	},
	(table) => [
		primaryKey({ columns: [table.sourceId, table.itemId] }),
		index("source_item_source_generation_rank_idx").on(
			table.sourceId,
			table.generation,
			table.rank
		),
		index("source_item_source_fetched_idx").on(table.sourceId, table.fetchedAt),
		index("source_item_source_published_idx").on(
			table.sourceId,
			table.publishedAt
		),
	]
);

export const trendsSummary = pgTable(
	"trends_summary",
	{
		topicId: text("topic_id").notNull(),
		lang: text("lang").notNull(),
		prompt: text("prompt").notNull(),
		text: text("text").notNull(),
		citations: jsonb("citations").$type<unknown[]>().notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	},
	(table) => [primaryKey({ columns: [table.topicId, table.lang] })]
);

export const sourceItemTranslation = pgTable(
	"source_item_translation",
	{
		sourceId: text("source_id").notNull(),
		itemId: text("item_id").notNull(),
		lang: text("lang").notNull(),
		textHash: text("text_hash").notNull(),
		title: text("title").notNull(),
		description: text("description"),
		model: text("model").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.sourceId, table.itemId, table.lang] }),
		index("source_item_translation_source_lang_idx").on(
			table.sourceId,
			table.lang
		),
		index("source_item_translation_lang_source_item_idx").on(
			table.lang,
			table.sourceId,
			table.itemId
		),
	]
);
