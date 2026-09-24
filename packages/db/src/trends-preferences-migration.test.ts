import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { file } from "bun";

const baseMigrationUrl = new URL(
	"./d1-migrations/0000_romantic_puck.sql",
	import.meta.url
);
const preferenceMigrationUrl = new URL(
	"./d1-migrations/0002_user_trends_preferences.sql",
	import.meta.url
);

describe("user trends preference migration", () => {
	test("enforces one preference per user/topic and cascades user deletion", async () => {
		const database = new Database(":memory:", { strict: true });
		database.exec("PRAGMA foreign_keys = ON");
		try {
			for (const migrationUrl of [baseMigrationUrl, preferenceMigrationUrl]) {
				const migration = await file(migrationUrl).text();
				database.exec(migration.replaceAll("--> statement-breakpoint", ""));
			}
			database
				.query(
					"INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
				)
				.run("user-1", "Ada", "ada@example.com", 1, 1, 1);
			database
				.query(
					"INSERT INTO user_trends_preference (user_id, topic_id, ordered_source_ids, hidden_source_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
				)
				.run("user-1", "ai", '["a"]', "[]", 1, 1);

			expect(() =>
				database
					.query(
						"INSERT INTO user_trends_preference (user_id, topic_id, ordered_source_ids, hidden_source_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
					)
					.run("user-1", "ai", "[]", "[]", 2, 2)
			).toThrow();

			database.query("DELETE FROM user WHERE id = ?").run("user-1");
			const count = database
				.query<{ count: number }, []>(
					"SELECT COUNT(*) AS count FROM user_trends_preference"
				)
				.get()?.count;
			expect(count).toBe(0);
		} finally {
			database.close();
		}
	});
});
