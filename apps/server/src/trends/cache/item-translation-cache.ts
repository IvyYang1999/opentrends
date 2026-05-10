import { db, schema } from "@opentrends/db";
import { and, eq, inArray, sql } from "drizzle-orm";

import type { TranslationLanguage } from "../services/translate-news-items";

const { sourceItemTranslation } = schema;

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

export async function readItemTranslations(params: {
	itemIds?: string[];
	lang: TranslationLanguage;
	sourceIds: string[];
}): Promise<CachedItemTranslation[]> {
	const sourceIds = [...new Set(params.sourceIds)];
	if (sourceIds.length === 0) {
		return [];
	}
	const itemIds = [...new Set(params.itemIds ?? [])];

	const rows =
		itemIds.length === 0
			? await db
					.select()
					.from(sourceItemTranslation)
					.where(
						and(
							eq(sourceItemTranslation.lang, params.lang),
							inArray(sourceItemTranslation.sourceId, sourceIds)
						)
					)
			: await db
					.select()
					.from(sourceItemTranslation)
					.where(
						and(
							eq(sourceItemTranslation.lang, params.lang),
							inArray(sourceItemTranslation.sourceId, sourceIds),
							inArray(sourceItemTranslation.itemId, itemIds)
						)
					);

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
