import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { embeddingUsage } from "../services/model-usage";

test("missing embedding usage is unknown and metadata cannot leak", () => {
	expect(embeddingUsage({ prompt_tokens: 8, input: "private" })).toBe(8);
	expect(embeddingUsage({ prompt_tokens: "8" })).toBeNull();
	expect(embeddingUsage(null)).toBeNull();
});

test("D1 ledger migration is repeatable and IDs deduplicate writes", () => {
	const db = new Database(":memory:");
	try {
		const migration = readFileSync(
			new URL(
				"../../../../../packages/db/src/d1-migrations/0001_dc_model_usage.sql",
				import.meta.url
			),
			"utf8"
		);
		db.exec(migration);
		db.exec(migration);
		const insert = db.prepare(
			"INSERT INTO dc_model_usage (id,product,model,operation,occurred_at,outcome) VALUES (?, 'opentrends','model','embedding','2026-09-13T00:00:00Z','ok') ON CONFLICT (id) DO NOTHING"
		);
		insert.run("same");
		insert.run("same");
		insert.run("different");
		expect(db.query("SELECT count(*) AS n FROM dc_model_usage").get()).toEqual({
			n: 2,
		});
	} finally {
		db.close();
	}
});
