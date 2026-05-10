CREATE TABLE "news_item_translation" (
	"source_id" text NOT NULL,
	"item_id" text NOT NULL,
	"lang" text NOT NULL,
	"text_hash" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"model" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "news_item_translation_source_id_item_id_lang_pk" PRIMARY KEY("source_id","item_id","lang")
);
--> statement-breakpoint
ALTER TABLE "trends_summary" ADD COLUMN "lang" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "trends_summary" DROP CONSTRAINT "trends_summary_pkey";--> statement-breakpoint
ALTER TABLE "trends_summary" ADD CONSTRAINT "trends_summary_topic_id_lang_pk" PRIMARY KEY("topic_id","lang");--> statement-breakpoint
ALTER TABLE "trends_summary" ALTER COLUMN "lang" DROP DEFAULT;--> statement-breakpoint
CREATE INDEX "news_item_translation_source_lang_idx" ON "news_item_translation" USING btree ("source_id","lang");
