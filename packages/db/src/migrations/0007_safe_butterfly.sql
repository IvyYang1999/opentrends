CREATE TABLE "source" (
	"source_id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'error' NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"fetched_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"stale_until" timestamp with time zone,
	"item_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"refresh_owner" text,
	"refresh_locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_item" (
	"source_id" text NOT NULL,
	"item_id" text NOT NULL,
	"generation" integer NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"image_url" text,
	"rank" integer NOT NULL,
	"published_at" timestamp with time zone,
	"fetched_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"content_hash" text NOT NULL,
	"hot_value" jsonb,
	"original" jsonb,
	CONSTRAINT "source_item_source_id_item_id_pk" PRIMARY KEY("source_id","item_id")
);
--> statement-breakpoint
CREATE INDEX "source_item_source_generation_rank_idx" ON "source_item" USING btree ("source_id","generation","rank");--> statement-breakpoint
CREATE INDEX "source_item_source_fetched_idx" ON "source_item" USING btree ("source_id","fetched_at");--> statement-breakpoint
CREATE INDEX "source_item_source_published_idx" ON "source_item" USING btree ("source_id","published_at");--> statement-breakpoint
INSERT INTO "source" (
	"source_id",
	"status",
	"generation",
	"fetched_at",
	"last_success_at",
	"expires_at",
	"stale_until",
	"item_count",
	"error_count",
	"last_error",
	"created_at",
	"updated_at"
)
SELECT
	"source_id",
	"status",
	1,
	"fetched_at",
	CASE WHEN "status" = 'ok' THEN "fetched_at" ELSE NULL END,
	"expires_at",
	"stale_until",
	jsonb_array_length("items"),
	"error_count",
	"last_error",
	now(),
	now()
FROM "source_snapshot"
ON CONFLICT ("source_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "source_item" (
	"source_id",
	"item_id",
	"generation",
	"url",
	"title",
	"description",
	"image_url",
	"rank",
	"published_at",
	"fetched_at",
	"last_seen_at",
	"content_hash",
	"hot_value",
	"original"
)
SELECT
	s."source_id",
	coalesce(item.value->>'id', item.value->>'url', s."source_id" || ':' || item.ordinality::text),
	1,
	coalesce(item.value->>'url', ''),
	coalesce(item.value->>'title', ''),
	item.value->>'description',
	item.value->>'imageUrl',
	coalesce(nullif(item.value->>'rank', '')::integer, item.ordinality::integer),
	CASE
		WHEN item.value ? 'publishedAt' THEN to_timestamp((item.value->>'publishedAt')::double precision / 1000)
		ELSE NULL
	END,
	CASE
		WHEN item.value ? 'fetchedAt' THEN to_timestamp((item.value->>'fetchedAt')::double precision / 1000)
		ELSE s."fetched_at"
	END,
	s."fetched_at",
	md5(concat_ws('|', item.value->>'title', item.value->>'description', item.value->>'url', item.value->>'publishedAt')),
	item.value->'hotValue',
	item.value->'original'
FROM "source_snapshot" s
CROSS JOIN LATERAL jsonb_array_elements(s."items") WITH ORDINALITY AS item(value, ordinality)
ON CONFLICT ("source_id", "item_id") DO NOTHING;
