CREATE TABLE IF NOT EXISTS "trend_event_topic" (
	"event_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "trend_event_topic_event_id_topic_id_pk" PRIMARY KEY("event_id","topic_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trend_event_topic_topic_idx" ON "trend_event_topic" USING btree ("topic_id");
