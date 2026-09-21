CREATE TABLE IF NOT EXISTS `user_trends_preference` (
	`user_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`ordered_source_ids` text NOT NULL,
	`hidden_source_ids` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`user_id`, `topic_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
