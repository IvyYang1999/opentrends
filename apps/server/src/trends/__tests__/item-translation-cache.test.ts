import { describe, expect, test } from "bun:test";

function setServerEnv(): void {
	process.env.BETTER_AUTH_SECRET = "x".repeat(32);
	process.env.BETTER_AUTH_URL = "http://localhost:3000";
	process.env.CORS_ORIGIN = "http://localhost:3001";
	process.env.TRENDS_REFRESH_SCHEDULER = "disabled";
}

// D1 rejects statements with more than 100 bound parameters; each statement
// also binds the language.
const D1_BOUND_PARAMETER_LIMIT = 100;

describe("item translation cache reads", () => {
	test("packs a full topic page into statements D1 accepts", async () => {
		setServerEnv();
		const { packTranslationReadBatches } = await import(
			"../cache/item-translation-cache"
		);
		const sourceIds: string[] = [];
		const itemIds: string[] = [];
		for (let source = 0; source < 77; source += 1) {
			for (let item = 0; item < 16; item += 1) {
				sourceIds.push(`source-${source}`);
				itemIds.push(`item-${source}-${item}`);
			}
		}

		const batches = packTranslationReadBatches(sourceIds, itemIds);

		for (const batch of batches) {
			expect(
				batch.sourceIds.length + batch.itemIds.length + 1
			).toBeLessThanOrEqual(D1_BOUND_PARAMETER_LIMIT);
		}
		const covered = new Set(
			batches.flatMap((batch) =>
				batch.itemIds.map((itemId) => {
					const sourceId = `source-${itemId.split("-")[1]}`;
					expect(batch.sourceIds).toContain(sourceId);
					return itemId;
				})
			)
		);
		expect(covered.size).toBe(itemIds.length);
	});

	test("splits a single source with more items than one statement can bind", async () => {
		setServerEnv();
		const { packTranslationReadBatches } = await import(
			"../cache/item-translation-cache"
		);
		const itemIds = Array.from({ length: 250 }, (_, index) => `item-${index}`);

		const batches = packTranslationReadBatches(
			itemIds.map(() => "only-source"),
			itemIds
		);

		expect(batches.length).toBeGreaterThan(1);
		expect(batches.flatMap((batch) => batch.itemIds)).toEqual(itemIds);
	});

	test("returns no statements when there is nothing to look up", async () => {
		setServerEnv();
		const { packTranslationReadBatches } = await import(
			"../cache/item-translation-cache"
		);

		expect(packTranslationReadBatches([], [])).toEqual([]);
	});
});
