import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { env } from "@opentrends/env/server";
import { streamText } from "ai";

import { type CacheEnvelope, hotCache } from "../cache/hot-cache";
import { readSummary, writeSummary } from "../cache/summary-cache";
import { getSourcePreset } from "../config/sources";
import { getTopicPreset } from "../config/topics";
import type { NewsItem, TopicPreset, TrendsPageData } from "../types";
import { getTrendsPage, TopicNotFoundError } from "./get-trends-page";
import { isSiliconFlow, trackSiliconFlowModel } from "./llm-usage";
import type { TranslationLanguage } from "./translate-news-items";

// A low per-source cap lets every section of a topic reach the prompt instead
// of the first few sources filling the whole citation budget.
const ITEMS_PER_SOURCE = 3;
// Hard cap on number of cited items per summary. Keeps the citation header
// well under common HTTP header limits and keeps the LLM prompt focused.
const MAX_CITATIONS = 60;
const RECENT_ITEM_WINDOW_MS = 48 * 60 * 60 * 1000;
const FALLBACK_ITEM_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// Below this many recent items the topic is too quiet for a 48h digest, so the
// window widens to a week.
const MIN_RECENT_ITEMS = 30;
const MIN_TARGET_SCRIPT_RATIO = 0.2;
const SUMMARY_LANGUAGE_RETRY_LIMIT = 1;
const SUMMARY_TTL_MS = 60 * 60 * 1000;
const SUMMARY_STALE_MS = 24 * 60 * 60 * 1000;
const SUMMARY_CACHE_RETENTION_MS = 7 * 24 * 60 * 60_000;
const SUMMARY_HOT_CACHE_SCHEMA_VERSION = 2;
const SUMMARY_PROMPT_VERSION = "top10-v1";
const SUMMARY_HOT_CACHE_TTL_SECONDS = Math.ceil(
	SUMMARY_CACHE_RETENTION_MS / 1000
);
const SUMMARY_FIRST_CHUNK_TIMEOUT_MS = 60_000;
const SUMMARY_IDLE_CHUNK_TIMEOUT_MS = 75_000;
const SUMMARY_CACHE_READ_TIMEOUT_MS = 1200;
const SUMMARY_CACHE_WRITE_TIMEOUT_MS = 1200;
const FALLBACK_ITEM_LIMIT = 6;
const CACHED_CHUNK_SIZE = 128;
const CACHED_CHUNK_DELAY_MS = 4;

class SummaryGenerationTimeoutError extends Error {
	constructor(timeoutMs: number) {
		super(`Timed out waiting ${timeoutMs}ms for trends summary output.`);
		this.name = "SummaryGenerationTimeoutError";
	}
}

class SummaryCacheReadTimeoutError extends Error {
	constructor() {
		super("Timed out reading cached trends summary.");
		this.name = "SummaryCacheReadTimeoutError";
	}
}

export interface Citation {
	n: number;
	url: string;
}

export interface PreparedSummary {
	citations: Citation[];
	stream: (abortSignal: AbortSignal) => AsyncGenerator<string, void, void>;
}

interface TrendsSummaryCacheOptions {
	waitUntil?: (promise: Promise<unknown>) => void;
}

export interface CitedItem {
	item: NewsItem;
	n: number;
	source: string;
}

interface CachedSummaryEntry {
	citations: Citation[];
	expiresAt: number;
	prompt: string;
	staleUntil: number;
	text: string;
}

const summaryTextCache = new Map<string, CachedSummaryEntry>();
const inFlightSummaryRefreshes = new Map<string, Promise<void>>();

export class TrendsSummaryNotConfiguredError extends Error {
	constructor() {
		super("Trends summary is not configured. Set LLM_API_KEY to enable it.");
		this.name = "TrendsSummaryNotConfiguredError";
	}
}

export function isTrendsSummaryConfigured(): boolean {
	return Boolean(env.LLM_API_KEY);
}

function isDescriptionRedundant(title: string, description: string): boolean {
	const t = title.toLowerCase();
	const d = description.toLowerCase();
	return d === t || d.startsWith(t) || t.startsWith(d);
}

interface SourceCandidates {
	items: NewsItem[];
	source: string;
}

function collectSourceCandidates(
	page: TrendsPageData,
	notBefore: number
): SourceCandidates[] {
	const result: SourceCandidates[] = [];
	for (const section of page.sections) {
		for (const source of section.sources) {
			const items = source.items
				.filter((item) => (item.publishedAt ?? item.fetchedAt) >= notBefore)
				.slice(0, ITEMS_PER_SOURCE);
			if (items.length === 0) {
				continue;
			}
			const preset = getSourcePreset(source.sourceId);
			result.push({ items, source: preset?.name ?? source.title });
		}
	}
	return result;
}

function countCandidates(sources: SourceCandidates[]): number {
	return sources.reduce((total, source) => total + source.items.length, 0);
}

export function collectCitedItems(
	page: TrendsPageData,
	now: number = Date.now()
): CitedItem[] {
	let sources = collectSourceCandidates(page, now - RECENT_ITEM_WINDOW_MS);
	if (countCandidates(sources) < MIN_RECENT_ITEMS) {
		sources = collectSourceCandidates(page, now - FALLBACK_ITEM_WINDOW_MS);
	}

	// Round-robin across sources: every source contributes its first item
	// before any source contributes a second one.
	const taken = sources.map(() => 0);
	let remaining = MAX_CITATIONS;
	for (let round = 0; round < ITEMS_PER_SOURCE && remaining > 0; round += 1) {
		for (const [index, source] of sources.entries()) {
			if (remaining === 0) {
				break;
			}
			if (source.items.length > round) {
				taken[index] = round + 1;
				remaining -= 1;
			}
		}
	}

	const result: CitedItem[] = [];
	let n = 0;
	for (const [index, source] of sources.entries()) {
		for (const item of source.items.slice(0, taken[index])) {
			n += 1;
			result.push({ n, source: source.source, item });
		}
	}
	return result;
}

function formatSourceItemDate(item: NewsItem): string {
	const timestamp = item.publishedAt ?? item.fetchedAt;
	const date = new Date(timestamp);
	if (Number.isNaN(date.getTime())) {
		return "date unknown";
	}
	const day = date.toISOString().slice(0, 10);
	return item.publishedAt ? `published ${day}` : `fetched ${day}`;
}

function hasCurrentPromptVersion(prompt: string): boolean {
	return prompt.includes(`Prompt version: ${SUMMARY_PROMPT_VERSION}`);
}

interface SummaryLanguageProfile {
	// Closing reminder written in the target language. Source items are mostly
	// English, and models tend to answer in the language of the material unless
	// the last thing they read says otherwise.
	closingReminder: string;
	name: string;
	reasonLimit: string;
	takeawayLimit: string;
}

const WORD_LIMITS = {
	reasonLimit: "max 20 words",
	takeawayLimit: "max 15 words",
};

const SUMMARY_LANGUAGE_PROFILES: Record<
	TranslationLanguage,
	SummaryLanguageProfile
> = {
	en: {
		...WORD_LIMITS,
		closingReminder: "Write the whole list in English.",
		name: "English",
	},
	zh: {
		closingReminder:
			"请只用简体中文输出整个列表，即使上面的条目是英文；公司名、产品名、模型名保留原文。",
		name: "Simplified Chinese",
		reasonLimit: "max 40 Chinese characters",
		takeawayLimit: "max 30 Chinese characters",
	},
	"zh-Hant": {
		closingReminder:
			"請只用繁體中文輸出整個列表，即使上面的項目是英文；公司名、產品名、模型名保留原文。",
		name: "Traditional Chinese",
		reasonLimit: "max 40 Chinese characters",
		takeawayLimit: "max 30 Chinese characters",
	},
	ru: {
		...WORD_LIMITS,
		closingReminder:
			"Напишите весь список только на русском языке, даже если материалы выше на английском.",
		name: "Russian",
	},
	"fr-FR": {
		...WORD_LIMITS,
		closingReminder:
			"Rédigez toute la liste uniquement en français, même si les éléments ci-dessus sont en anglais.",
		name: "French (France)",
	},
	"es-ES": {
		...WORD_LIMITS,
		closingReminder:
			"Escribe toda la lista únicamente en español, aunque los elementos anteriores estén en inglés.",
		name: "Spanish (Spain)",
	},
	"de-DE": {
		...WORD_LIMITS,
		closingReminder:
			"Schreiben Sie die gesamte Liste ausschließlich auf Deutsch, auch wenn die Einträge oben auf Englisch sind.",
		name: "German (Germany)",
	},
	"pt-BR": {
		...WORD_LIMITS,
		closingReminder:
			"Escreva toda a lista somente em português do Brasil, mesmo que os itens acima estejam em inglês.",
		name: "Portuguese (Brazil)",
	},
};

export function buildPrompt(
	topic: TopicPreset,
	cited: CitedItem[],
	lang: TranslationLanguage = "en"
): string {
	const lines: string[] = [];
	lines.push(`Prompt version: ${SUMMARY_PROMPT_VERSION}`);
	lines.push(`Topic: ${topic.title}`);
	if (topic.description) {
		lines.push(`Description: ${topic.description}`);
	}
	lines.push("");
	lines.push(
		"Numbered items you may cite. Each line is `[N] [Source] (item date) Title — short description` (description shown when available):"
	);
	lines.push("");

	for (const { n, source, item } of cited) {
		const description = item.description?.trim();
		const includeDesc =
			description && !isDescriptionRedundant(item.title, description);
		const suffix = includeDesc ? ` — ${description}` : "";
		lines.push(
			`[${n}] [${source}] (${formatSourceItemDate(item)}) ${item.title}${suffix}`
		);
	}

	lines.push("");
	lines.push(SUMMARY_LANGUAGE_PROFILES[lang].closingReminder);

	return lines.join("\n");
}

export function buildSystemPrompt(lang: TranslationLanguage): string {
	const profile = SUMMARY_LANGUAGE_PROFILES[lang];
	return [
		"You are the editor of OpenTrends, a dashboard of first-hand tech sources.",
		"From the numbered items the user gives you, pick the 10 things most worth knowing today.",
		"Rules:",
		"- Merge items that report the same story into one entry and cite all of them. A story covered by several sources matters more.",
		"- Prefer the newest items. Skip promotions, ticket sales, job posts, and pure opinion pieces.",
		"- Output only a Markdown ordered list numbered `1.`, `2.`, `3.` … with at most 10 entries (fewer when the material is thin). No heading, no preamble, no closing remarks, no blank lines between entries.",
		`- Each entry is one line: \`1. **Takeaway in one sentence (${profile.takeawayLimit})** — why it is worth reading (${profile.reasonLimit}) [N][M]\`.`,
		`- Write everything in ${profile.name}, whatever language the items are in. Keep company, product, and model names in their original form.`,
		"- End each entry with citation tags in the form `[N]`, where N is the item number. Cite several items adjacent like `[3][7]`, never `[3, 7]`. Only cite numbers that appear in the list.",
	].join("\n");
}

const CJK_CHAR_RE = /[\u3400-\u9fff]/g;
const CYRILLIC_CHAR_RE = /\p{Script=Cyrillic}/gu;
const LATIN_CHAR_RE = /\p{Script=Latin}/gu;

function countMatches(text: string, pattern: RegExp): number {
	return text.match(pattern)?.length ?? 0;
}

// Only scripts that differ from the mostly-English source material can be
// checked cheaply; Latin-script targets always pass.
export function isWrittenInTargetLanguage(
	text: string,
	lang: TranslationLanguage
): boolean {
	let target: number;
	if (lang === "zh" || lang === "zh-Hant") {
		target = countMatches(text, CJK_CHAR_RE);
	} else if (lang === "ru") {
		target = countMatches(text, CYRILLIC_CHAR_RE);
	} else {
		return true;
	}
	const latin = countMatches(text, LATIN_CHAR_RE);
	if (target + latin === 0) {
		return true;
	}
	return target / (target + latin) >= MIN_TARGET_SCRIPT_RATIO;
}

function makeSummaryCacheKey(
	topicId: string,
	lang: TranslationLanguage
): string {
	return `${topicId}:${lang}`;
}

function makeSummaryHotCacheKey(
	topicId: string,
	lang: TranslationLanguage
): string {
	return `trends:v1:summary:${topicId}:${lang}`;
}

function readMemorySummary(
	topicId: string,
	lang: TranslationLanguage
): CachedSummaryEntry | null {
	const cached = summaryTextCache.get(makeSummaryCacheKey(topicId, lang));
	if (!cached) {
		return null;
	}
	const text = cached.text.trim();
	return text ? cached : null;
}

function hydrateMemorySummary(
	topicId: string,
	lang: TranslationLanguage,
	entry: CachedSummaryEntry
): void {
	summaryTextCache.set(makeSummaryCacheKey(topicId, lang), entry);
}

async function readHotSummaryCache(
	topicId: string,
	lang: TranslationLanguage
): Promise<CachedSummaryEntry | null> {
	const envelope = await hotCache.get<CachedSummaryEntry>(
		makeSummaryHotCacheKey(topicId, lang)
	);
	if (
		!envelope ||
		envelope.schemaVersion !== SUMMARY_HOT_CACHE_SCHEMA_VERSION
	) {
		return null;
	}
	const text = envelope.value.text.trim();
	if (!hasCurrentPromptVersion(envelope.value.prompt)) {
		return null;
	}
	return text ? envelope.value : null;
}

async function writeHotSummaryCache(
	topicId: string,
	lang: TranslationLanguage,
	entry: CachedSummaryEntry
): Promise<void> {
	const now = Date.now();
	const envelope: CacheEnvelope<CachedSummaryEntry> = {
		createdAt: now,
		freshUntil: entry.expiresAt,
		schemaVersion: SUMMARY_HOT_CACHE_SCHEMA_VERSION,
		staleUntil: entry.staleUntil,
		value: entry,
	};
	await hotCache.put(
		makeSummaryHotCacheKey(topicId, lang),
		envelope,
		SUMMARY_HOT_CACHE_TTL_SECONDS
	);
}

async function readSummaryWithTimeout(
	topicId: string,
	lang: TranslationLanguage
): Promise<Awaited<ReturnType<typeof readSummary>>> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			readSummary(topicId, lang),
			new Promise<never>((_, reject) => {
				timeout = setTimeout(
					() => reject(new SummaryCacheReadTimeoutError()),
					SUMMARY_CACHE_READ_TIMEOUT_MS
				);
			}),
		]);
	} finally {
		if (timeout) {
			clearTimeout(timeout);
		}
	}
}

function cachedSummaryToEntry(
	cached: Awaited<ReturnType<typeof readSummary>>
): CachedSummaryEntry | null {
	if (!cached) {
		return null;
	}
	const text = cached.text.trim();
	if (!text) {
		return null;
	}
	if (!hasCurrentPromptVersion(cached.prompt)) {
		return null;
	}
	return {
		citations: cached.citations,
		expiresAt: cached.expiresAt,
		prompt: cached.prompt,
		staleUntil: cached.createdAt + SUMMARY_STALE_MS,
		text: cached.text,
	};
}

async function readAnyCachedSummary(
	topicId: string,
	lang: TranslationLanguage
): Promise<CachedSummaryEntry | null> {
	const memory = readMemorySummary(topicId, lang);
	if (memory) {
		return memory;
	}

	const hotCached = await readHotSummaryCache(topicId, lang);
	if (hotCached) {
		hydrateMemorySummary(topicId, lang, hotCached);
		return hotCached;
	}

	try {
		const cached = await readSummaryWithTimeout(topicId, lang);
		if (cached) {
			const entry = cachedSummaryToEntry(cached);
			if (entry) {
				hydrateMemorySummary(topicId, lang, entry);
				await writeHotSummaryCache(topicId, lang, entry);
			}
			return entry;
		}
	} catch (error) {
		if (!(error instanceof SummaryCacheReadTimeoutError)) {
			console.warn("[trends-summary] failed to read cached summary", error);
		}
	}
	return null;
}

async function refreshSummaryCache(
	topicId: string,
	lang: TranslationLanguage
): Promise<void> {
	if (!env.LLM_API_KEY) {
		throw new TrendsSummaryNotConfiguredError();
	}
	const topic = getTopicPreset(topicId);
	if (!topic) {
		throw new TopicNotFoundError(topicId);
	}
	const page = await getTrendsPage(topicId, lang);
	const cited = collectCitedItems(page);
	const citations: Citation[] = cited.map(({ n, item }) => ({
		n,
		url: item.url,
	}));
	const prompt = buildPrompt(topic, cited, lang);
	const cached = await readSummaryWithTimeout(topicId, lang);
	const cachedEntry = cachedSummaryToEntry(cached);
	if (cachedEntry && cachedEntry.prompt === prompt) {
		hydrateMemorySummary(topicId, lang, cachedEntry);
		await writeHotSummaryCache(topicId, lang, cachedEntry);
		return;
	}

	const controller = new AbortController();
	for (let attempt = 0; attempt <= SUMMARY_LANGUAGE_RETRY_LIMIT; attempt += 1) {
		for await (const _chunk of streamGeneratedSummary({
			citations,
			cited,
			lang,
			prompt,
			topic,
			topicId,
			abortSignal: controller.signal,
		})) {
			// Consume the generator so it can write the completed summary to cache.
		}
		// A summary in the wrong language is never cached, so a missing entry
		// here means the attempt has to be repeated.
		if (readMemorySummary(topicId, lang)?.prompt === prompt) {
			return;
		}
	}
}

function startSummaryRefresh(
	topicId: string,
	lang: TranslationLanguage
): Promise<void> {
	const cacheKey = makeSummaryCacheKey(topicId, lang);
	const inFlight = inFlightSummaryRefreshes.get(cacheKey);
	if (inFlight) {
		return inFlight;
	}
	const refresh = (async () => {
		try {
			await refreshSummaryCache(topicId, lang);
		} finally {
			inFlightSummaryRefreshes.delete(cacheKey);
		}
	})();
	inFlightSummaryRefreshes.set(cacheKey, refresh);
	return refresh;
}

export function refreshTrendsSummaryCache(
	topicId: string,
	lang: TranslationLanguage
): Promise<void> {
	return startSummaryRefresh(topicId, lang);
}

function refreshSummaryInBackground(
	refresh: Promise<void>,
	waitUntil: TrendsSummaryCacheOptions["waitUntil"]
): void {
	const observedRefresh = refresh.catch((error) => {
		console.warn("[trends-summary] background refresh failed", error);
	});
	if (waitUntil) {
		waitUntil(observedRefresh);
	}
}

async function withTimeout<T>(
	promise: Promise<T>,
	ms: number,
	label: string
): Promise<T> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timeout = setTimeout(() => reject(new Error(label)), ms);
			}),
		]);
	} finally {
		if (timeout) {
			clearTimeout(timeout);
		}
	}
}

async function writeCachedSummary(params: {
	citations: Citation[];
	lang: TranslationLanguage;
	prompt: string;
	text: string;
	topicId: string;
}): Promise<void> {
	const now = Date.now();
	const entry: CachedSummaryEntry = {
		citations: params.citations,
		expiresAt: now + SUMMARY_TTL_MS,
		prompt: params.prompt,
		staleUntil: now + SUMMARY_STALE_MS,
		text: params.text,
	};
	hydrateMemorySummary(params.topicId, params.lang, entry);
	await writeHotSummaryCache(params.topicId, params.lang, entry);
	try {
		await withTimeout(
			writeSummary({
				topicId: params.topicId,
				lang: params.lang,
				prompt: params.prompt,
				text: params.text,
				citations: params.citations,
				createdAt: now,
				ttlMs: SUMMARY_TTL_MS,
			}),
			SUMMARY_CACHE_WRITE_TIMEOUT_MS,
			"Timed out writing cached trends summary."
		);
	} catch (error) {
		console.warn("[trends-summary] failed to write cached summary", error);
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function* replayCachedSummary(
	text: string,
	abortSignal: AbortSignal
): AsyncGenerator<string, void, void> {
	for (let i = 0; i < text.length; i += CACHED_CHUNK_SIZE) {
		if (abortSignal.aborted) {
			return;
		}
		yield text.slice(i, i + CACHED_CHUNK_SIZE);
		if (i + CACHED_CHUNK_SIZE < text.length) {
			await delay(CACHED_CHUNK_DELAY_MS);
		}
	}
}

async function readNextSummaryChunk(
	iterator: AsyncIterator<string>,
	timeoutMs: number
): Promise<IteratorResult<string>> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			iterator.next(),
			new Promise<never>((_, reject) => {
				timeout = setTimeout(
					() => reject(new SummaryGenerationTimeoutError(timeoutMs)),
					timeoutMs
				);
			}),
		]);
	} finally {
		if (timeout) {
			clearTimeout(timeout);
		}
	}
}

async function* streamGeneratedSummary(params: {
	citations: Citation[];
	cited: CitedItem[];
	lang: TranslationLanguage;
	prompt: string;
	topic: TopicPreset;
	topicId: string;
	abortSignal: AbortSignal;
}): AsyncGenerator<string, void, void> {
	const provider = createOpenAICompatible({
		name: "llm",
		apiKey: env.LLM_API_KEY ?? "",
		baseURL: env.LLM_BASE_URL,
		includeUsage: isSiliconFlow(env.LLM_BASE_URL),
	});
	const chunks: string[] = [];
	let iterator: AsyncIterator<string> | undefined;
	try {
		const result = streamText({
			abortSignal: params.abortSignal,
			model: trackSiliconFlowModel(
				provider(env.LLM_MODEL),
				"summary",
				env.LLM_BASE_URL
			),
			system: buildSystemPrompt(params.lang),
			prompt: params.prompt,
		});
		iterator = result.textStream[Symbol.asyncIterator]();
		let timeoutMs = SUMMARY_FIRST_CHUNK_TIMEOUT_MS;
		while (true) {
			const next = await readNextSummaryChunk(iterator, timeoutMs);
			if (next.done) {
				break;
			}
			const chunk = next.value;
			if (!chunk) {
				continue;
			}
			chunks.push(chunk);
			timeoutMs = SUMMARY_IDLE_CHUNK_TIMEOUT_MS;
			yield chunk;
		}
		const text = chunks.join("").trim();
		if (text && !isWrittenInTargetLanguage(text, params.lang)) {
			console.warn(
				`[trends-summary] discarded ${params.topicId} summary not written in ${params.lang}`
			);
		} else if (text) {
			await writeCachedSummary({
				citations: params.citations,
				lang: params.lang,
				prompt: params.prompt,
				text,
				topicId: params.topicId,
			});
		}
	} catch (error) {
		try {
			await Promise.race([
				iterator?.return?.() ?? Promise.resolve(),
				delay(100),
			]);
		} catch {
			/* Ignore cleanup failures after a generation timeout. */
		}
		console.warn("[trends-summary] failed to stream model summary", error);
		if (chunks.length === 0) {
			yield buildFallbackSummary(params.topic, params.cited, params.lang);
		}
	}
}

function buildFallbackSummary(
	topic: TopicPreset,
	cited: CitedItem[],
	lang: TranslationLanguage
): string {
	const top = cited.slice(0, FALLBACK_ITEM_LIMIT);
	if (top.length === 0) {
		if (lang === "zh") {
			return `当前 ${topic.title} 暂时没有可用于总结的最新条目。`;
		}
		if (lang === "zh-Hant") {
			return `目前 ${topic.title} 暫時沒有可用於總結的最新項目。`;
		}
		if (lang === "ru") {
			return `Пока нет свежих материалов по теме ${topic.title} для сводки.`;
		}
		return `No recent ${topic.title} items are available for summarization yet.`;
	}

	const bullets = top.map(({ item, n }) => `- ${item.title} [${n}]`).join("\n");
	if (lang === "zh") {
		return [
			`当前 ${topic.title} 的最新动态主要包括：`,
			"",
			bullets,
			"",
			"模型总结暂时不可用，以上是基于最新标题生成的降级摘要。",
		].join("\n");
	}
	if (lang === "zh-Hant") {
		return [
			`目前 ${topic.title} 的最新動態主要包括：`,
			"",
			bullets,
			"",
			"模型總結暫時不可用，以上是基於最新標題生成的降級摘要。",
		].join("\n");
	}
	if (lang === "ru") {
		return [
			`Свежие обновления по теме ${topic.title} сейчас включают:`,
			"",
			bullets,
			"",
			"Модельная сводка временно недоступна, поэтому это резервная сводка по последним заголовкам.",
		].join("\n");
	}
	return [
		`Current ${topic.title} updates are led by these recent items:`,
		"",
		bullets,
		"",
		"The model summary is temporarily unavailable, so this fallback is based on the latest headlines.",
	].join("\n");
}

export async function prepareTrendsSummary(
	topicId: string,
	lang: TranslationLanguage = "en",
	options: TrendsSummaryCacheOptions = {}
): Promise<PreparedSummary> {
	if (!env.LLM_API_KEY) {
		throw new TrendsSummaryNotConfiguredError();
	}
	const topic = getTopicPreset(topicId);
	if (!topic) {
		throw new TopicNotFoundError(topicId);
	}

	const cachedSummary = await readAnyCachedSummary(topicId, lang);
	if (cachedSummary) {
		if (cachedSummary.expiresAt <= Date.now()) {
			refreshSummaryInBackground(
				startSummaryRefresh(topicId, lang),
				options.waitUntil
			);
		}
		return {
			citations: cachedSummary.citations,
			stream: (abortSignal) =>
				replayCachedSummary(cachedSummary.text, abortSignal),
		};
	}

	const page = await getTrendsPage(topicId, lang);
	const cited = collectCitedItems(page);
	const citations: Citation[] = cited.map(({ n, item }) => ({
		n,
		url: item.url,
	}));
	const prompt = buildPrompt(topic, cited, lang);

	return {
		citations,
		stream: (abortSignal) =>
			streamGeneratedSummary({
				citations,
				cited,
				lang,
				prompt,
				topic,
				topicId,
				abortSignal,
			}),
	};
}
