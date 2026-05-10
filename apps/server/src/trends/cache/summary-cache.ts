import { db, schema } from "@opentrends/db";
import { and, eq } from "drizzle-orm";

import type { Citation } from "../services/get-trends-summary";
import type { TranslationLanguage } from "../services/translate-news-items";

const { trendsSummary } = schema;

export interface CachedSummary {
	citations: Citation[];
	createdAt: number;
	expiresAt: number;
	prompt: string;
	text: string;
}

export async function readSummary(
	topicId: string,
	lang: TranslationLanguage
): Promise<CachedSummary | null> {
	const rows = await db
		.select()
		.from(trendsSummary)
		.where(
			and(eq(trendsSummary.topicId, topicId), eq(trendsSummary.lang, lang))
		)
		.limit(1);

	const row = rows[0];
	if (!row) {
		return null;
	}

	return {
		citations: (row.citations ?? []) as Citation[],
		createdAt: row.createdAt.getTime(),
		expiresAt: row.expiresAt.getTime(),
		prompt: row.prompt,
		text: row.text,
	};
}

export async function writeSummary(params: {
	topicId: string;
	lang: TranslationLanguage;
	prompt: string;
	text: string;
	citations: Citation[];
	createdAt: number;
	ttlMs: number;
}): Promise<void> {
	const { topicId, lang, prompt, text, citations, createdAt, ttlMs } = params;
	const createdAtDate = new Date(createdAt);
	const expiresAt = new Date(createdAt + ttlMs);

	await db
		.insert(trendsSummary)
		.values({
			topicId,
			lang,
			prompt,
			text,
			citations,
			createdAt: createdAtDate,
			expiresAt,
		})
		.onConflictDoUpdate({
			target: [trendsSummary.topicId, trendsSummary.lang],
			set: {
				prompt,
				text,
				citations,
				createdAt: createdAtDate,
				expiresAt,
			},
		});
}
