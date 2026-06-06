CREATE TABLE "source_item_embedding" (
	"source_id" text NOT NULL,
	"item_id" text NOT NULL,
	"text_hash" text NOT NULL,
	"embedding" jsonb NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "source_item_embedding_source_id_item_id_pk" PRIMARY KEY("source_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "trend_event" (
	"event_id" text PRIMARY KEY NOT NULL,
	"topic_id" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"score" integer DEFAULT 0 NOT NULL,
	"source_count" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"primary_source_id" text,
	"primary_item_id" text,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trend_event_source_item" (
	"event_id" text NOT NULL,
	"source_id" text NOT NULL,
	"item_id" text NOT NULL,
	"is_primary" integer DEFAULT 0 NOT NULL,
	"merge_confidence" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "trend_event_source_item_event_id_source_id_item_id_pk" PRIMARY KEY("event_id","source_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "trend_event_topic" (
	"event_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "trend_event_topic_event_id_topic_id_pk" PRIMARY KEY("event_id","topic_id")
);
--> statement-breakpoint
ALTER TABLE "source_item" ADD COLUMN "content_text" text;--> statement-breakpoint
ALTER TABLE "source_item" ADD COLUMN "content_fetched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_item" ADD COLUMN "content_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "source_item" ADD COLUMN "content_error" text;--> statement-breakpoint
CREATE INDEX "source_item_embedding_model_idx" ON "source_item_embedding" USING btree ("model");--> statement-breakpoint
CREATE INDEX "trend_event_topic_score_idx" ON "trend_event" USING btree ("topic_id","score");--> statement-breakpoint
CREATE INDEX "trend_event_topic_last_seen_idx" ON "trend_event" USING btree ("topic_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "trend_event_topic_first_seen_idx" ON "trend_event" USING btree ("topic_id","first_seen_at");--> statement-breakpoint
CREATE INDEX "trend_event_source_item_source_item_idx" ON "trend_event_source_item" USING btree ("source_id","item_id");
--> statement-breakpoint
CREATE INDEX "trend_event_topic_topic_idx" ON "trend_event_topic" USING btree ("topic_id");
