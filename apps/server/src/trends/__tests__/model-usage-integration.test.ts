import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { type AppDatabase, runWithDbClient } from "@opentrends/db";
import { runWithServerEnv } from "@opentrends/env/server";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { embedTexts } from "../services/event-embedding";

const migration = readFileSync(
	new URL(
		"../../../../../packages/db/src/d1-migrations/0001_dc_model_usage.sql",
		import.meta.url
	),
	"utf8"
);
const bindings = {
	BETTER_AUTH_SECRET: "test".repeat(8),
	BETTER_AUTH_URL: "http://localhost:3000",
	CORS_ORIGIN: "http://localhost:3001",
	SILICONFLOW_API_KEY: "test-key",
	SILICONFLOW_EMBEDDING_MODEL: "test/embedding",
};

async function collect(response: () => Response, database: Database) {
	const previous = globalThis.fetch;
	globalThis.fetch = () => Promise.resolve(response());
	try {
		return await runWithServerEnv(bindings, () =>
			runWithDbClient(drizzle(database) as unknown as AppDatabase, () =>
				embedTexts(["private input must never reach the ledger"])
			)
		);
	} finally {
		globalThis.fetch = previous;
	}
}

test("real embedding path writes counters, preserves vectors and excludes content", async () => {
	const database = new Database(":memory:");
	try {
		database.exec(migration);
		const result = await collect(
			() =>
				Response.json({
					data: [{ index: 0, embedding: [1, 2] }],
					usage: { prompt_tokens: 17, input: "private" },
				}),
			database
		);
		expect(result).toEqual([[1, 2]]);
		const rows = database.query("SELECT * FROM dc_model_usage").all();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			product: "opentrends",
			model: "test/embedding",
			operation: "embedding",
			input_tokens: 17,
			output_tokens: 0,
			cached_tokens: 0,
			outcome: "ok",
		});
		expect(JSON.stringify(rows)).not.toContain("private");
	} finally {
		database.close();
	}
});

test("invalid provider vectors count as failed calls while retaining returned token usage", async () => {
	const database = new Database(":memory:");
	try {
		database.exec(migration);
		await expect(
			collect(
				() => Response.json({ data: [], usage: { prompt_tokens: 9 } }),
				database
			)
		).rejects.toThrow("missing vector");
		expect(
			database.query("SELECT input_tokens, outcome FROM dc_model_usage").get()
		).toEqual({ input_tokens: 9, outcome: "error" });
	} finally {
		database.close();
	}
});

test("provider failures keep unknown tokens distinct from zero", async () => {
	const database = new Database(":memory:");
	try {
		database.exec(migration);
		await expect(
			collect(() => new Response("unavailable", { status: 503 }), database)
		).rejects.toThrow("503");
		expect(
			database.query("SELECT input_tokens, outcome FROM dc_model_usage").get()
		).toEqual({ input_tokens: null, outcome: "error" });
	} finally {
		database.close();
	}
});

test("a missing ledger does not fail the product operation", async () => {
	const database = new Database(":memory:");
	try {
		expect(
			await collect(
				() => Response.json({ data: [{ index: 0, embedding: [3] }] }),
				database
			)
		).toEqual([[3]]);
	} finally {
		database.close();
	}
});
