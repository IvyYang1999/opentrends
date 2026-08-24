import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { file } from "bun";

const migrationUrl = new URL(
	"./d1-migrations/0000_romantic_puck.sql",
	import.meta.url
);

describe("fresh D1 schema", () => {
	test("applies to an empty SQLite database", async () => {
		const database = new Database(":memory:");
		try {
			const migration = await file(migrationUrl).text();
			database.exec(migration.replaceAll("--> statement-breakpoint", ""));
			const tables = database
				.query<{ name: string }, []>(
					"select name from sqlite_master where type = 'table' order by name"
				)
				.all()
				.map(({ name }) => name);

			expect(tables).toEqual([
				"account",
				"session",
				"source",
				"source_item",
				"source_item_embedding",
				"source_item_translation",
				"trend_event",
				"trend_event_source_item",
				"trend_event_topic",
				"trends_summary",
				"user",
				"verification",
			]);
		} finally {
			database.close();
		}
	});
});
