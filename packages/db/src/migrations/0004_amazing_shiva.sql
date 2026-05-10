CREATE TABLE "trends_page_cache" (
	"topic_id" text NOT NULL,
	"lang" text NOT NULL,
	"page" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"fresh_until" timestamp with time zone NOT NULL,
	"stale_until" timestamp with time zone NOT NULL,
	CONSTRAINT "trends_page_cache_topic_id_lang_pk" PRIMARY KEY("topic_id","lang")
);
--> statement-breakpoint
CREATE INDEX "trends_page_cache_fresh_until_idx" ON "trends_page_cache" USING btree ("fresh_until");--> statement-breakpoint
CREATE INDEX "trends_page_cache_stale_until_idx" ON "trends_page_cache" USING btree ("stale_until");