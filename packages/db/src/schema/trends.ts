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
		contentText: text("content_text"),
		contentFetchedAt: timestamp("content_fetched_at", { withTimezone: true }),
		contentStatus: text("content_status").default("pending").notNull(),
		contentError: text("content_error"),
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

export const sourceItemEmbedding = pgTable(
	"source_item_embedding",
	{
		sourceId: text("source_id").notNull(),
		itemId: text("item_id").notNull(),
		textHash: text("text_hash").notNull(),
		embedding: jsonb("embedding").$type<number[]>().notNull(),
		model: text("model").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.sourceId, table.itemId] }),
		index("source_item_embedding_model_idx").on(table.model),
	]
);

export const trendEvent = pgTable(
	"trend_event",
	{
		eventId: text("event_id").primaryKey(),
		topicId: text("topic_id").notNull(),
		title: text("title").notNull(),
		summary: text("summary"),
		score: integer("score").default(0).notNull(),
		sourceCount: integer("source_count").default(0).notNull(),
		firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
		lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
		primarySourceId: text("primary_source_id"),
		primaryItemId: text("primary_item_id"),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
	},
	(table) => [
		index("trend_event_topic_score_idx").on(table.topicId, table.score),
		index("trend_event_topic_last_seen_idx").on(
			table.topicId,
			table.lastSeenAt
		),
		index("trend_event_topic_first_seen_idx").on(
			table.topicId,
			table.firstSeenAt
		),
	]
);

export const trendEventSourceItem = pgTable(
	"trend_event_source_item",
	{
		eventId: text("event_id").notNull(),
		sourceId: text("source_id").notNull(),
		itemId: text("item_id").notNull(),
		isPrimary: integer("is_primary").default(0).notNull(),
		mergeConfidence: integer("merge_confidence").default(0).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.eventId, table.sourceId, table.itemId] }),
		index("trend_event_source_item_source_item_idx").on(
			table.sourceId,
			table.itemId
		),
	]
);

export const trendEventTopic = pgTable(
	"trend_event_topic",
	{
		eventId: text("event_id").notNull(),
		topicId: text("topic_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.eventId, table.topicId] }),
		index("trend_event_topic_topic_idx").on(table.topicId),
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
