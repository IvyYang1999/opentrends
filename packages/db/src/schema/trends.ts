import { sql } from "drizzle-orm";
import {
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch())`;

export const source = sqliteTable("source", {
	sourceId: text("source_id").primaryKey(),
	status: text("status").default("error").notNull(),
	generation: integer("generation").default(0).notNull(),
	fetchedAt: integer("fetched_at", { mode: "timestamp" }),
	lastSuccessAt: integer("last_success_at", { mode: "timestamp" }),
	expiresAt: integer("expires_at", { mode: "timestamp" }),
	staleUntil: integer("stale_until", { mode: "timestamp" }),
	itemCount: integer("item_count").default(0).notNull(),
	errorCount: integer("error_count").default(0).notNull(),
	lastError: text("last_error"),
	refreshOwner: text("refresh_owner"),
	refreshLockedUntil: integer("refresh_locked_until", { mode: "timestamp" }),
	createdAt: integer("created_at", { mode: "timestamp" })
		.default(now)
		.notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" })
		.default(now)
		.notNull(),
});

export const sourceItem = sqliteTable(
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
		publishedAt: integer("published_at", { mode: "timestamp" }),
		fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull(),
		lastSeenAt: integer("last_seen_at", { mode: "timestamp" }).notNull(),
		contentHash: text("content_hash").notNull(),
		contentText: text("content_text"),
		contentFetchedAt: integer("content_fetched_at", { mode: "timestamp" }),
		contentStatus: text("content_status").default("pending").notNull(),
		contentError: text("content_error"),
		hotValue: text("hot_value", { mode: "json" }).$type<
			string | number | null
		>(),
		original: text("original", { mode: "json" }).$type<{
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

export const sourceItemEmbedding = sqliteTable(
	"source_item_embedding",
	{
		sourceId: text("source_id").notNull(),
		itemId: text("item_id").notNull(),
		textHash: text("text_hash").notNull(),
		embedding: text("embedding", { mode: "json" }).$type<number[]>().notNull(),
		model: text("model").notNull(),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.sourceId, table.itemId] }),
		index("source_item_embedding_model_idx").on(table.model),
	]
);

export const trendEvent = sqliteTable(
	"trend_event",
	{
		eventId: text("event_id").primaryKey(),
		topicId: text("topic_id").notNull(),
		title: text("title").notNull(),
		summary: text("summary"),
		score: integer("score").default(0).notNull(),
		sourceCount: integer("source_count").default(0).notNull(),
		firstSeenAt: integer("first_seen_at", { mode: "timestamp" }).notNull(),
		lastSeenAt: integer("last_seen_at", { mode: "timestamp" }).notNull(),
		primarySourceId: text("primary_source_id"),
		primaryItemId: text("primary_item_id"),
		updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
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

export const trendEventSourceItem = sqliteTable(
	"trend_event_source_item",
	{
		eventId: text("event_id").notNull(),
		sourceId: text("source_id").notNull(),
		itemId: text("item_id").notNull(),
		isPrimary: integer("is_primary").default(0).notNull(),
		mergeConfidence: integer("merge_confidence").default(0).notNull(),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.eventId, table.sourceId, table.itemId] }),
		index("trend_event_source_item_source_item_idx").on(
			table.sourceId,
			table.itemId
		),
	]
);

export const trendEventTopic = sqliteTable(
	"trend_event_topic",
	{
		eventId: text("event_id").notNull(),
		topicId: text("topic_id").notNull(),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.eventId, table.topicId] }),
		index("trend_event_topic_topic_idx").on(table.topicId),
	]
);

export const trendsSummary = sqliteTable(
	"trends_summary",
	{
		topicId: text("topic_id").notNull(),
		lang: text("lang").notNull(),
		prompt: text("prompt").notNull(),
		text: text("text").notNull(),
		citations: text("citations", { mode: "json" }).$type<unknown[]>().notNull(),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
		expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
	},
	(table) => [primaryKey({ columns: [table.topicId, table.lang] })]
);

export const sourceItemTranslation = sqliteTable(
	"source_item_translation",
	{
		sourceId: text("source_id").notNull(),
		itemId: text("item_id").notNull(),
		lang: text("lang").notNull(),
		textHash: text("text_hash").notNull(),
		title: text("title").notNull(),
		description: text("description"),
		model: text("model").notNull(),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
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
