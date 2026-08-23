CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `source` (
	`source_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'error' NOT NULL,
	`generation` integer DEFAULT 0 NOT NULL,
	`fetched_at` integer,
	`last_success_at` integer,
	`expires_at` integer,
	`stale_until` integer,
	`item_count` integer DEFAULT 0 NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`refresh_owner` text,
	`refresh_locked_until` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_item` (
	`source_id` text NOT NULL,
	`item_id` text NOT NULL,
	`generation` integer NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`image_url` text,
	`rank` integer NOT NULL,
	`published_at` integer,
	`fetched_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`content_hash` text NOT NULL,
	`content_text` text,
	`content_fetched_at` integer,
	`content_status` text DEFAULT 'pending' NOT NULL,
	`content_error` text,
	`hot_value` text,
	`original` text,
	PRIMARY KEY(`source_id`, `item_id`)
);
--> statement-breakpoint
CREATE INDEX `source_item_source_generation_rank_idx` ON `source_item` (`source_id`,`generation`,`rank`);--> statement-breakpoint
CREATE INDEX `source_item_source_fetched_idx` ON `source_item` (`source_id`,`fetched_at`);--> statement-breakpoint
CREATE INDEX `source_item_source_published_idx` ON `source_item` (`source_id`,`published_at`);--> statement-breakpoint
CREATE TABLE `source_item_embedding` (
	`source_id` text NOT NULL,
	`item_id` text NOT NULL,
	`text_hash` text NOT NULL,
	`embedding` text NOT NULL,
	`model` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`source_id`, `item_id`)
);
--> statement-breakpoint
CREATE INDEX `source_item_embedding_model_idx` ON `source_item_embedding` (`model`);--> statement-breakpoint
CREATE TABLE `source_item_translation` (
	`source_id` text NOT NULL,
	`item_id` text NOT NULL,
	`lang` text NOT NULL,
	`text_hash` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`model` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`source_id`, `item_id`, `lang`)
);
--> statement-breakpoint
CREATE INDEX `source_item_translation_source_lang_idx` ON `source_item_translation` (`source_id`,`lang`);--> statement-breakpoint
CREATE INDEX `source_item_translation_lang_source_item_idx` ON `source_item_translation` (`lang`,`source_id`,`item_id`);--> statement-breakpoint
CREATE TABLE `trend_event` (
	`event_id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`score` integer DEFAULT 0 NOT NULL,
	`source_count` integer DEFAULT 0 NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`primary_source_id` text,
	`primary_item_id` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trend_event_topic_score_idx` ON `trend_event` (`topic_id`,`score`);--> statement-breakpoint
CREATE INDEX `trend_event_topic_last_seen_idx` ON `trend_event` (`topic_id`,`last_seen_at`);--> statement-breakpoint
CREATE INDEX `trend_event_topic_first_seen_idx` ON `trend_event` (`topic_id`,`first_seen_at`);--> statement-breakpoint
CREATE TABLE `trend_event_source_item` (
	`event_id` text NOT NULL,
	`source_id` text NOT NULL,
	`item_id` text NOT NULL,
	`is_primary` integer DEFAULT 0 NOT NULL,
	`merge_confidence` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`event_id`, `source_id`, `item_id`)
);
--> statement-breakpoint
CREATE INDEX `trend_event_source_item_source_item_idx` ON `trend_event_source_item` (`source_id`,`item_id`);--> statement-breakpoint
CREATE TABLE `trend_event_topic` (
	`event_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`event_id`, `topic_id`)
);
--> statement-breakpoint
CREATE INDEX `trend_event_topic_topic_idx` ON `trend_event_topic` (`topic_id`);--> statement-breakpoint
CREATE TABLE `trends_summary` (
	`topic_id` text NOT NULL,
	`lang` text NOT NULL,
	`prompt` text NOT NULL,
	`text` text NOT NULL,
	`citations` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`topic_id`, `lang`)
);
