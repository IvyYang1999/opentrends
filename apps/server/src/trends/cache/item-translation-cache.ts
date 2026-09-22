import { db, schema } from "@opentrends/db";
import { and, eq, inArray, sql } from "drizzle-orm";

import type { TranslationLanguage } from "../services/translate-news-items";

const { sourceItemTranslation } = schema;
// D1 rejects statements with more than 100 bound parameters. Each exact
// source lookup binds the language and source id before its item ids.
const TRANSLATION_READ_PARAM_BUDGET = 90;
const BROAD_SOURCE_READ_THRESHOLD = 8;

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

// Keep every statement scoped to one source. The previous cross-product query
// (`source_id IN (...) AND item_id IN (...)`) made SQLite examine many
// impossible source/item combinations on a full topic page and regularly
// missed the reader's deadline despite all translations already being cached.
export function packTranslationReadBatches(
	sourceIds: readonly string[],
	itemIds: readonly string[]
): TranslationReadBatch[] {
	if (itemIds.length === 0) {
		return chunk([...new Set(sourceIds)], TRANSLATION_READ_PARAM_BUDGET).map(
			(batch) => ({ itemIds: [], sourceIds: batch })
		);
	}

	const itemsBySource = groupItemsBySource(sourceIds, itemIds);
	if (itemsBySource.size > BROAD_SOURCE_READ_THRESHOLD) {
		return chunk([...itemsBySource.keys()], TRANSLATION_READ_PARAM_BUDGET).map(
			(batch) => ({ itemIds: [], sourceIds: batch })
		);
	}

	const batches: TranslationReadBatch[] = [];
	const itemBudget = TRANSLATION_READ_PARAM_BUDGET - 1;
	for (const [sourceId, sourceItems] of itemsBySource) {
		for (const itemBatch of chunk([...sourceItems], itemBudget)) {
			batches.push({ itemIds: itemBatch, sourceIds: [sourceId] });
		}
	}
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
	const requestedPairs =
		params.itemIds?.length === params.sourceIds.length
			? new Set(
					params.sourceIds.map(
						(sourceId, index) => `${sourceId}:${params.itemIds?.[index]}`
					)
				)
			: undefined;
	const [first, ...rest] = packTranslationReadBatches(
		params.sourceIds,
		params.itemIds ?? []
	).map((batch) => selectTranslationBatch(params.lang, batch));
	if (!first) {
		return [];
	}

	const results: TranslationRow[][] = await db.batch([first, ...rest]);
	const rows = requestedPairs
		? results
				.flat()
				.filter((row) => requestedPairs.has(`${row.sourceId}:${row.itemId}`))
		: results.flat();

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
