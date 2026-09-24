import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { file } from "bun";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";

import type { SourceId } from "../types";

function setServerEnv(): void {
	process.env.BETTER_AUTH_SECRET = "x".repeat(32);
	process.env.BETTER_AUTH_URL = "http://localhost:3000";
	process.env.CORS_ORIGIN = "http://localhost:3001";
	process.env.TRENDS_REFRESH_SCHEDULER = "disabled";
}

const migrationUrl = new URL(
	"../../../../../packages/db/src/d1-migrations/0000_romantic_puck.sql",
	import.meta.url
);
const DAY_SECONDS = 86_400;
const NOW_SECONDS = 1_790_000_000;

async function createDatabase(): Promise<Database> {
	const database = new Database(":memory:");
	const migration = await file(migrationUrl).text();
	database.exec(migration.replaceAll("--> statement-breakpoint", ""));
	return database;
}

function insertItem(
	database: Database,
	item: {
		ageDays: number;
		id: string;
		originalTitle?: string;
		published?: boolean;
		rank: number;
		sourceId: string;
		title?: string;
	}
): void {
	const time = NOW_SECONDS - item.ageDays * DAY_SECONDS;
	database
		.query(
			`insert into source_item
				(source_id, item_id, generation, url, title, description, rank,
				 published_at, fetched_at, last_seen_at, content_hash, original)
			 values (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 'hash', ?)`
		)
		.run(
			item.sourceId,
			item.id,
			`https://example.com/${item.id}`,
			item.title ?? `Title ${item.id}`,
			"d".repeat(1000),
			item.rank,
			item.published === false ? null : time,
			time,
			time,
			item.originalTitle ? JSON.stringify({ title: item.originalTitle }) : null
		);
}

describe("source item history query", () => {
	test("keeps the best items of each day per source inside the window", async () => {
		setServerEnv();
		const { buildSourceItemHistoryQuery, historyRowToNewsItem } = await import(
			"../cache/source-cache"
		);
		const database = await createDatabase();
		try {
			for (const day of [0, 1, 2]) {
				for (const rank of [1, 2, 3]) {
					insertItem(database, {
						ageDays: day,
						id: `busy-${day}-${rank}`,
						rank,
						sourceId: "busy",
					});
				}
			}
			insertItem(database, {
				ageDays: 5,
				id: "slow-1",
				published: false,
				rank: 1,
				sourceId: "slow",
			});
			insertItem(database, {
				ageDays: 40,
				id: "slow-old",
				rank: 1,
				sourceId: "slow",
			});
			insertItem(database, {
				ageDays: 0,
				id: "other-1",
				rank: 1,
				sourceId: "not-requested",
			});

			const query = new SQLiteSyncDialect().sqlToQuery(
				buildSourceItemHistoryQuery(
					["busy", "slow"] as SourceId[],
					(NOW_SECONDS - 7 * DAY_SECONDS) * 1000,
					2
				)
			);
			const rows = database
				.query(query.sql)
				.all(...(query.params as (number | string)[]));
			const items = rows.map((row) =>
				historyRowToNewsItem(row as Parameters<typeof historyRowToNewsItem>[0])
			);

			expect(items.map((item) => item.id)).toEqual([
				"busy-0-1",
				"busy-0-2",
				"busy-1-1",
				"busy-1-2",
				"busy-2-1",
				"busy-2-2",
				"slow-1",
			]);
			expect(items[0]?.publishedAt).toBe(NOW_SECONDS * 1000);
			expect(items[0]?.description).toHaveLength(280);
			expect(items.at(-1)?.publishedAt).toBeUndefined();
		} finally {
			database.close();
		}
	});

	test("filters keywords before taking each day's top item", async () => {
		setServerEnv();
		const { buildSourceItemHistoryQuery, historyRowToNewsItem } = await import(
			"../cache/source-cache"
		);
		const database = await createDatabase();
		try {
			for (const day of [0, 1]) {
				insertItem(database, {
					ageDays: day,
					id: `unrelated-${day}`,
					rank: 1,
					sourceId: "feed",
					title: "Claude Opus 5.5",
				});
				insertItem(database, {
					ageDays: day,
					id: `gpt-${day}`,
					rank: 2,
					sourceId: "feed",
					originalTitle: day === 1 ? "GPT-6 release" : undefined,
					title: day === 1 ? "新模型发布" : "GPT-6 release",
				});
			}

			const query = new SQLiteSyncDialect().sqlToQuery(
				buildSourceItemHistoryQuery(
					["feed"] as SourceId[],
					(NOW_SECONDS - 7 * DAY_SECONDS) * 1000,
					1,
					["GPT6"]
				)
			);
			const rows = database
				.query(query.sql)
				.all(...(query.params as (number | string)[]));
			const items = rows.map((row) =>
				historyRowToNewsItem(row as Parameters<typeof historyRowToNewsItem>[0])
			);

			expect(items.map((item) => item.id)).toEqual(["gpt-0", "gpt-1"]);
		} finally {
			database.close();
		}
	});
});
