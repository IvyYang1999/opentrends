ALTER TABLE "source_snapshot" ADD COLUMN "page_items" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "source_snapshot"
SET "page_items" = coalesce((
	SELECT jsonb_agg(item)
	FROM (VALUES
		("items"->0),
		("items"->1),
		("items"->2),
		("items"->3),
		("items"->4),
		("items"->5),
		("items"->6),
		("items"->7),
		("items"->8),
		("items"->9),
		("items"->10),
		("items"->11)
	) AS limited(item)
	WHERE item IS NOT NULL
), '[]'::jsonb);
