import { createHash } from "node:crypto";

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { env } from "@opentrends/env/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import { isMissingCacheSchemaError } from "../cache/cache-errors";
import {
	type CachedItemTranslation,
	readItemTranslations,
	writeItemTranslations,
} from "../cache/item-translation-cache";
import type { NewsItem, SourceCardData, TrendsPageData } from "../types";

export const TRANSLATION_LANGUAGES = [
	"en",
	"zh",
	"zh-Hant",
	"ru",
	"fr-FR",
	"es-ES",
	"de-DE",
	"pt-BR",
] as const;
export type TranslationLanguage = (typeof TRANSLATION_LANGUAGES)[number];
export type TranslationMode = "background" | "sync";

interface TranslationCandidate {
	cacheKey: string;
	item: NewsItem;
	sourceId: string;
	textHash: string;
}

type WritableTranslation = Omit<
	CachedItemTranslation,
	"createdAt" | "updatedAt"
>;

const BATCH_SIZE = 12;
const BACKGROUND_TRANSLATION_CACHE_TIMEOUT_MS = 1200;
const SYNC_TRANSLATION_CONCURRENCY = 6;
const SYNC_TRANSLATION_TIMEOUT_MS = 20_000;
const CJK_RE = /[\u3400-\u9fff]/;
const CYRILLIC_RE = /\p{Script=Cyrillic}/u;
const TRANSLATED_BATCH_SCHEMA = z.object({
	items: z.array(
		z.object({
			description: z.string().nullable(),
			id: z.string(),
			title: z.string(),
		})
	),
});

class TranslationCacheReadTimeoutError extends Error {
	constructor() {
		super("Timed out reading cached item translations.");
		this.name = "TranslationCacheReadTimeoutError";
	}
}

export function isTranslationLanguage(
	value: string | undefined
): value is TranslationLanguage {
	return (
		value !== undefined &&
		(TRANSLATION_LANGUAGES as readonly string[]).includes(value)
	);
}

export function normalizeTranslationLanguage(
	value: string | undefined
): TranslationLanguage {
	return isTranslationLanguage(value) ? value : "en";
}

function hasCjk(value: string | undefined): boolean {
	return value ? CJK_RE.test(value) : false;
}

function hasCyrillic(value: string | undefined): boolean {
	return value ? CYRILLIC_RE.test(value) : false;
}

function shouldTranslateText(
	value: string | undefined,
	lang: TranslationLanguage
): boolean {
	if (!value?.trim()) {
		return false;
	}
	if (lang === "zh") {
		return !hasCjk(value);
	}
	if (lang === "zh-Hant") {
		return true;
	}
	if (lang === "ru") {
		return !hasCyrillic(value);
	}
	if (
		lang === "fr-FR" ||
		lang === "es-ES" ||
		lang === "de-DE" ||
		lang === "pt-BR"
	) {
		return true;
	}
	return hasCjk(value) || hasCyrillic(value);
}

function shouldTranslateItem(
	item: NewsItem,
	lang: TranslationLanguage
): boolean {
	return (
		shouldTranslateText(item.title, lang) ||
		shouldTranslateText(item.description, lang)
	);
}

function hashItemText(item: NewsItem): string {
	const payload = JSON.stringify({
		description: item.description ?? null,
		title: item.title,
	});
	return createHash("sha256").update(payload).digest("hex");
}

function makeCacheKey(
	lang: TranslationLanguage,
	sourceId: string,
	itemId: string,
	textHash: string
): string {
	return `${lang}:${sourceId}:${itemId}:${textHash}`;
}

function makeTranslationMap(
	rows: CachedItemTranslation[]
): Map<string, CachedItemTranslation> {
	const map = new Map<string, CachedItemTranslation>();
	for (const row of rows) {
		map.set(`${row.sourceId}:${row.itemId}`, row);
	}
	return map;
}

function applyTranslation(
	item: NewsItem,
	translation: CachedItemTranslation | WritableTranslation
): NewsItem {
	return {
		...item,
		description: translation.description ?? undefined,
		original: {
			description: item.description,
			title: item.title,
		},
		title: translation.title,
	};
}

function chunk<T>(items: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		chunks.push(items.slice(i, i + size));
	}
	return chunks;
}

async function readCachedTranslations(params: {
	itemIds: string[];
	lang: TranslationLanguage;
	mode: TranslationMode;
	sourceIds: string[];
}): Promise<CachedItemTranslation[]> {
	const readPromise = readItemTranslations({
		itemIds: params.itemIds,
		lang: params.lang,
		sourceIds: params.sourceIds,
	});
	if (params.mode !== "background") {
		return readPromise;
	}
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			readPromise,
			new Promise<never>((_, reject) => {
				timeout = setTimeout(
					() => reject(new TranslationCacheReadTimeoutError()),
					BACKGROUND_TRANSLATION_CACHE_TIMEOUT_MS
				);
			}),
		]);
	} finally {
		if (timeout) {
			clearTimeout(timeout);
		}
	}
}

function providerModel() {
	const provider = createOpenAICompatible({
		name: "llm",
		apiKey: env.LLM_API_KEY ?? "",
		baseURL: env.LLM_BASE_URL,
	});
	return provider(env.LLM_MODEL);
}

function targetLanguageName(lang: TranslationLanguage): string {
	if (lang === "zh") {
		return "Simplified Chinese";
	}
	if (lang === "zh-Hant") {
		return "Traditional Chinese";
	}
	if (lang === "ru") {
		return "Russian";
	}
	if (lang === "fr-FR") {
		return "French (France)";
	}
	if (lang === "es-ES") {
		return "Spanish (Spain)";
	}
	if (lang === "de-DE") {
		return "German (Germany)";
	}
	if (lang === "pt-BR") {
		return "Portuguese (Brazil)";
	}
	return "English";
}

function cleanDescription(value: string | null): string | null {
	if (value === null) {
		return null;
	}
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

async function translateBatch(
	lang: TranslationLanguage,
	candidates: TranslationCandidate[],
	abortSignal?: AbortSignal
): Promise<WritableTranslation[]> {
	if (!env.LLM_API_KEY || candidates.length === 0) {
		return [];
	}

	const inputs = candidates.map((candidate, index) => ({
		description: candidate.item.description ?? null,
		id: String(index),
		title: candidate.item.title,
	}));
	const { output } = await generateText({
		abortSignal,
		model: providerModel(),
		output: Output.object({
			schema: TRANSLATED_BATCH_SCHEMA,
		}),
		prompt: [
			`Translate these news titles and short descriptions into ${targetLanguageName(lang)}.`,
			"Preserve names, product names, company names, code identifiers, model names, ticker symbols, and URLs exactly when appropriate.",
			"Do not add facts, commentary, markdown, citations, or surrounding prose.",
			"Return every input id exactly once. Keep description as null when the input description is null.",
			"",
			JSON.stringify({ items: inputs }),
		].join("\n"),
	});

	const translations: WritableTranslation[] = [];
	for (const row of output.items) {
		const index = Number.parseInt(row.id, 10);
		const candidate = candidates[index];
		const title = row.title.trim();
		if (!(candidate && title)) {
			continue;
		}
		translations.push({
			description: cleanDescription(row.description),
			itemId: candidate.item.id,
			lang,
			model: env.LLM_MODEL,
			sourceId: candidate.sourceId,
			textHash: candidate.textHash,
			title,
		});
	}

	await writeItemTranslations(translations);
	return translations;
}

async function translateBatchResilient(
	lang: TranslationLanguage,
	candidates: TranslationCandidate[],
	abortSignal?: AbortSignal
): Promise<WritableTranslation[]> {
	try {
		return await translateBatch(lang, candidates, abortSignal);
	} catch (error) {
		if (abortSignal?.aborted) {
			throw error;
		}
		if (candidates.length <= 1) {
			console.warn("[trends-translation] failed to translate item", error);
			return [];
		}
		const midpoint = Math.ceil(candidates.length / 2);
		const [left, right] = await Promise.all([
			translateBatchResilient(lang, candidates.slice(0, midpoint), abortSignal),
			translateBatchResilient(lang, candidates.slice(midpoint), abortSignal),
		]);
		return [...left, ...right];
	}
}

async function translateMissingWithinTimeout(
	lang: TranslationLanguage,
	candidates: TranslationCandidate[],
	timeoutMs: number
): Promise<WritableTranslation[]> {
	if (candidates.length === 0) {
		return [];
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => {
		controller.abort();
	}, timeoutMs);
	const batches = chunk(candidates, BATCH_SIZE);
	const translations: WritableTranslation[] = [];
	let nextBatch = 0;

	async function worker(): Promise<void> {
		while (!controller.signal.aborted && nextBatch < batches.length) {
			const batch = batches[nextBatch];
			nextBatch += 1;
			if (!batch) {
				continue;
			}
			try {
				translations.push(
					...(await translateBatchResilient(lang, batch, controller.signal))
				);
			} catch (error) {
				if (!controller.signal.aborted) {
					console.warn("[trends-translation] failed to translate batch", error);
				}
			}
		}
	}

	try {
		if (!controller.signal.aborted) {
			await Promise.all(
				Array.from(
					{
						length: Math.min(SYNC_TRANSLATION_CONCURRENCY, batches.length),
					},
					() => worker()
				)
			);
		}
	} finally {
		clearTimeout(timeout);
	}
	return translations;
}

function collectTranslationCandidates(
	page: TrendsPageData,
	lang: TranslationLanguage
): TranslationCandidate[] {
	const candidates = new Map<string, TranslationCandidate>();
	for (const section of page.sections) {
		for (const source of section.sources) {
			for (const item of source.items) {
				if (item.original) {
					continue;
				}
				if (!shouldTranslateItem(item, lang)) {
					continue;
				}
				const textHash = hashItemText(item);
				const cacheKey = makeCacheKey(lang, source.sourceId, item.id, textHash);
				candidates.set(cacheKey, {
					cacheKey,
					item,
					sourceId: source.sourceId,
					textHash,
				});
			}
		}
	}
	return [...candidates.values()];
}

export async function translateTrendsPage(
	page: TrendsPageData,
	lang: TranslationLanguage,
	mode: TranslationMode = "background"
): Promise<TrendsPageData> {
	if (!env.LLM_API_KEY) {
		return page;
	}

	const uniqueCandidates = collectTranslationCandidates(page, lang);
	if (uniqueCandidates.length === 0) {
		return page;
	}

	const sourceIds = uniqueCandidates.map((candidate) => candidate.sourceId);
	const itemIds = uniqueCandidates.map((candidate) => candidate.item.id);
	let cachedRows: CachedItemTranslation[];
	try {
		cachedRows = await readCachedTranslations({
			itemIds,
			lang,
			mode,
			sourceIds,
		});
	} catch (error) {
		if (isMissingCacheSchemaError(error)) {
			return page;
		}
		if (error instanceof TranslationCacheReadTimeoutError) {
			return page;
		}
		console.warn(
			"[trends-translation] failed to read cached translations",
			error
		);
		return page;
	}
	const cached = makeTranslationMap(cachedRows);
	const translations = new Map<
		string,
		CachedItemTranslation | WritableTranslation
	>();
	const missing: TranslationCandidate[] = [];

	for (const candidate of uniqueCandidates) {
		const cachedRow = cached.get(`${candidate.sourceId}:${candidate.item.id}`);
		if (cachedRow?.textHash === candidate.textHash) {
			translations.set(`${candidate.sourceId}:${candidate.item.id}`, cachedRow);
		} else {
			missing.push(candidate);
		}
	}

	if (mode === "sync") {
		const translatedRows = await translateMissingWithinTimeout(
			lang,
			missing,
			SYNC_TRANSLATION_TIMEOUT_MS
		);
		for (const row of translatedRows) {
			translations.set(`${row.sourceId}:${row.itemId}`, row);
		}
	}

	if (translations.size === 0) {
		return page;
	}

	return {
		...page,
		sections: page.sections.map((section) => ({
			...section,
			sources: section.sources.map(
				(source): SourceCardData => ({
					...source,
					items: source.items.map((item) => {
						const translation = translations.get(
							`${source.sourceId}:${item.id}`
						);
						return translation ? applyTranslation(item, translation) : item;
					}),
				})
			),
		})),
	};
}
