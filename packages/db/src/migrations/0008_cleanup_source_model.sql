ALTER TABLE "news_item_translation" RENAME TO "source_item_translation";
--> statement-breakpoint
ALTER TABLE "source_item_translation" RENAME CONSTRAINT "news_item_translation_source_id_item_id_lang_pk" TO "source_item_translation_source_id_item_id_lang_pk";
--> statement-breakpoint
ALTER INDEX "news_item_translation_source_lang_idx" RENAME TO "source_item_translation_source_lang_idx";
--> statement-breakpoint
ALTER INDEX "news_item_translation_lang_source_item_idx" RENAME TO "source_item_translation_lang_source_item_idx";
--> statement-breakpoint
DROP TABLE IF EXISTS "source_refresh_lock";
--> statement-breakpoint
DROP TABLE IF EXISTS "source_snapshot";
