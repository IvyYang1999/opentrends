import { db, schema } from "@opentrends/db";
import { and, eq, inArray, sql } from "drizzle-orm";

import type { TranslationLanguage } from "../services/translate-news-items";

const { sourceItemTranslation } = schema;
// D1 rejects statements with more than 100 bound parameters. One parameter is
// the language; the rest are shared between source ids and item ids.
const TRANSLATION_READ_PARAM_BUDGET = 90;

type TranslationRow = typeof sourceItemTranslation.$inferSelect;

export interface CachedItemTranslation {
	createdAt: number;
	description: string | null;
	itemId: string;
	lang: TranslationLanguage;
	model: string;
	sourceId: string;
	textHash: string;
	title: string;
	updatedAt: number;
}

export interface TranslationReadBatch {
	itemIds: string[];
	sourceIds: string[];
}

function chunk<T>(items: readonly T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		chunks.push(items.slice(i, i + size));
	}
	return chunks;
}

function groupItemsBySource(
	sourceIds: readonly string[],
	itemIds: readonly string[]
): Map<string, Set<string>> {
	const itemsBySource = new Map<string, Set<string>>();
	if (itemIds.length !== sourceIds.length) {
		const uniqueItemIds = new Set(itemIds);
		for (const sourceId of sourceIds) {
			itemsBySource.set(sourceId, uniqueItemIds);
		}
		return itemsBySource;
	}
	for (const [index, sourceId] of sourceIds.entries()) {
		const items = itemsBySource.get(sourceId) ?? new Set<string>();
		items.add(itemIds[index] as string);
		itemsBySource.set(sourceId, items);
	}
	return itemsBySource;
}

// Splits a lookup into statements that each stay under D1's bound-parameter
// limit. `sourceIds` and `itemIds` are index-aligned pairs when they have the
// same length; items are kept next to their own source so a batch never needs
// more source ids than it has items.
export function packTranslationReadBatches(
	sourceIds: readonly string[],
	itemIds: readonly string[]
): TranslationReadBatch[] {
	if (itemIds.length === 0) {
		return chunk([...new Set(sourceIds)], TRANSLATION_READ_PARAM_BUDGET).map(
			(batch) => ({ itemIds: [], sourceIds: batch })
		);
	}

	const batches: TranslationReadBatch[] = [];
	let sources = new Set<string>();
	let items = new Set<string>();
	const flush = () => {
		if (items.size > 0) {
			batches.push({ itemIds: [...items], sourceIds: [...sources] });
		}
		sources = new Set();
		items = new Set();
	};
	for (const [sourceId, sourceItems] of groupItemsBySource(
		sourceIds,
		itemIds
	)) {
		for (const itemId of sourceItems) {
			const added =
				(sources.has(sourceId) ? 0 : 1) + (items.has(itemId) ? 0 : 1);
			if (sources.size + items.size + added > TRANSLATION_READ_PARAM_BUDGET) {
				flush();
			}
			sources.add(sourceId);
			items.add(itemId);
		}
	}
	flush();
	return batches;
}

function selectTranslationBatch(
	lang: TranslationLanguage,
	batch: TranslationReadBatch
) {
	const conditions = [
		eq(sourceItemTranslation.lang, lang),
		inArray(sourceItemTranslation.sourceId, batch.sourceIds),
	];
	if (batch.itemIds.length > 0) {
		conditions.push(inArray(sourceItemTranslation.itemId, batch.itemIds));
	}
	return db
		.select()
		.from(sourceItemTranslation)
		.where(and(...conditions));
}

export async function readItemTranslations(params: {
	itemIds?: string[];
	lang: TranslationLanguage;
	sourceIds: string[];
}): Promise<CachedItemTranslation[]> {
	const [first, ...rest] = packTranslationReadBatches(
		params.sourceIds,
		params.itemIds ?? []
	).map((batch) => selectTranslationBatch(params.lang, batch));
	if (!first) {
		return [];
	}

	const results: TranslationRow[][] = await db.batch([first, ...rest]);
	const rows = results.flat();

	return rows.map((row) => ({
		createdAt: row.createdAt.getTime(),
		description: row.description,
		itemId: row.itemId,
		lang: row.lang as TranslationLanguage,
		model: row.model,
		sourceId: row.sourceId,
		textHash: row.textHash,
		title: row.title,
		updatedAt: row.updatedAt.getTime(),
	}));
}

export async function writeItemTranslations(
	rows: Omit<CachedItemTranslation, "createdAt" | "updatedAt">[]
): Promise<void> {
	if (rows.length === 0) {
		return;
	}

	const now = new Date();

	await db
		.insert(sourceItemTranslation)
		.values(
			rows.map((row) => ({
				...row,
				createdAt: now,
				updatedAt: now,
			}))
		)
		.onConflictDoUpdate({
			target: [
				sourceItemTranslation.sourceId,
				sourceItemTranslation.itemId,
				sourceItemTranslation.lang,
			],
			set: {
				description: sql`excluded.description`,
				model: sql`excluded.model`,
				textHash: sql`excluded.text_hash`,
				title: sql`excluded.title`,
				updatedAt: now,
			},
		});
}
