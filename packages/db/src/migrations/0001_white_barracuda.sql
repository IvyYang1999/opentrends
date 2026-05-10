CREATE TABLE "trends_summary" (
	"topic_id" text PRIMARY KEY NOT NULL,
	"prompt" text NOT NULL,
	"text" text NOT NULL,
	"citations" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
