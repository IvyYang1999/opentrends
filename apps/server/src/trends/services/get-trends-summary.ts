import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { env } from "@opentrends/env/server";
import { streamText } from "ai";

import { type CacheEnvelope, hotCache } from "../cache/hot-cache";
import { readSourceItemHistory } from "../cache/source-cache";
import { readSummary, writeSummary } from "../cache/summary-cache";
import { getSourcePreset } from "../config/sources";
import { getTopicPreset } from "../config/topics";
import type { NewsItem, SourceId, TopicPreset, TrendsPageData } from "../types";
import { getTrendsPage, TopicNotFoundError } from "./get-trends-page";
import { llmProviderOptions } from "./llm";
import { isSiliconFlow, trackSiliconFlowModel } from "./llm-usage";
import type { TranslationLanguage } from "./translate-news-items";

// Clients that still read citations from the response header only get this
// many, which keeps the header under common HTTP header limits.
export const HEADER_CITATION_LIMIT = 60;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MIN_TARGET_SCRIPT_RATIO = 0.2;
const SUMMARY_LANGUAGE_RETRY_LIMIT = 1;

export const SUMMARY_WINDOWS = ["today", "week", "month"] as const;
export type SummaryWindow = (typeof SUMMARY_WINDOWS)[number];

interface SummaryWindowProfile {
	// How the editor prompt names the period.
	editorialPeriod: string;
	// Below `minItems` candidates the window widens to `fallbackWindowMs`, so a
	// quiet topic still gets a digest.
	fallbackWindowMs?: number;
	// History windows sample this many items per source per day so one busy
	// feed cannot crowd out a whole week or month.
	historyItemsPerSourcePerDay?: number;
	// A low per-source cap lets every section of a topic reach the prompt
	// instead of the first few sources filling the whole citation budget.
	itemsPerSource: number;
	// Cap on items in the prompt. Longer periods get a larger budget so that
	// sampling is less likely to drop the period's major stories.
	maxCitations: number;
	minItems?: number;
	staleMs: number;
	ttlMs: number;
	windowMs: number;
}

const SUMMARY_WINDOW_PROFILES: Record<SummaryWindow, SummaryWindowProfile> = {
	today: {
		editorialPeriod: "from the last 24 hours",
		fallbackWindowMs: 3 * DAY_MS,
		itemsPerSource: 6,
		maxCitations: 80,
		minItems: 40,
		staleMs: DAY_MS,
		ttlMs: HOUR_MS,
		windowMs: DAY_MS,
	},
	week: {
		editorialPeriod: "from the last 7 days",
		historyItemsPerSourcePerDay: 2,
		itemsPerSource: 8,
		maxCitations: 150,
		staleMs: 2 * DAY_MS,
		ttlMs: 6 * HOUR_MS,
		windowMs: 7 * DAY_MS,
	},
	month: {
		editorialPeriod: "from the last 30 days",
		historyItemsPerSourcePerDay: 1,
		itemsPerSource: 8,
		maxCitations: 150,
		staleMs: 3 * DAY_MS,
		ttlMs: DAY_MS,
		windowMs: 30 * DAY_MS,
	},
};

export function normalizeSummaryWindow(
	value: string | undefined
): SummaryWindow {
	return (SUMMARY_WINDOWS as readonly string[]).includes(value ?? "")
		? (value as SummaryWindow)
		: "today";
}

// Summary caches are keyed by topic and language. Non-default windows get
// their own topic key so they never overwrite the default digest.
function summaryCacheTopicId(topicId: string, window: SummaryWindow): string {
	return window === "today" ? topicId : `${topicId}#${window}`;
}

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
	window?: SummaryWindow;
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

function itemTime(item: NewsItem): number {
	return item.publishedAt ?? item.fetchedAt;
}

function collectPageCandidates(
	page: TrendsPageData,
	notBefore: number,
	itemsPerSource: number
): SourceCandidates[] {
	const result: SourceCandidates[] = [];
	for (const section of page.sections) {
		for (const source of section.sources) {
			const items = source.items
				.filter((item) => itemTime(item) >= notBefore)
				.slice(0, itemsPerSource);
			if (items.length === 0) {
				continue;
			}
			const preset = getSourcePreset(source.sourceId);
			result.push({ items, source: preset?.name ?? source.title });
		}
	}
	return result;
}

// Orders a source's items so that taking a prefix spreads over the window:
// the first item of every day (newest day first), then the second of every
// day, and so on.
export function interleaveByDay(items: NewsItem[]): NewsItem[] {
	const days = new Map<number, NewsItem[]>();
	for (const item of [...items].sort((a, b) => itemTime(b) - itemTime(a))) {
		const day = Math.floor(itemTime(item) / DAY_MS);
		days.set(day, [...(days.get(day) ?? []), item]);
	}
	const result: NewsItem[] = [];
	const buckets = [...days.values()];
	for (let depth = 0; result.length < items.length; depth += 1) {
		for (const bucket of buckets) {
			const item = bucket[depth];
			if (item) {
				result.push(item);
			}
		}
	}
	return result;
}

function collectHistoryCandidates(
	topic: TopicPreset,
	history: Map<SourceId, NewsItem[]>,
	itemsPerSource: number
): SourceCandidates[] {
	const result: SourceCandidates[] = [];
	for (const section of topic.sections) {
		for (const sourceId of section.sourceIds) {
			const items = interleaveByDay(history.get(sourceId) ?? []).slice(
				0,
				itemsPerSource
			);
			if (items.length === 0) {
				continue;
			}
			result.push({
				items,
				source: getSourcePreset(sourceId)?.name ?? sourceId,
			});
		}
	}
	return result;
}

function countCandidates(sources: SourceCandidates[]): number {
	return sources.reduce((total, source) => total + source.items.length, 0);
}

// Round-robin across sources: every source contributes its first item before
// any source contributes a second one.
export function selectCitedItems(
	sources: SourceCandidates[],
	maxCitations: number
): CitedItem[] {
	const taken = sources.map(() => 0);
	const rounds = Math.max(0, ...sources.map((source) => source.items.length));
	let remaining = maxCitations;
	for (let round = 0; round < rounds && remaining > 0; round += 1) {
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

export function collectCitedItems(
	page: TrendsPageData,
	now: number = Date.now()
): CitedItem[] {
	const profile = SUMMARY_WINDOW_PROFILES.today;
	let sources = collectPageCandidates(
		page,
		now - profile.windowMs,
		profile.itemsPerSource
	);
	if (
		profile.fallbackWindowMs !== undefined &&
		countCandidates(sources) < (profile.minItems ?? 0)
	) {
		sources = collectPageCandidates(
			page,
			now - profile.fallbackWindowMs,
			profile.itemsPerSource
		);
	}
	return selectCitedItems(sources, profile.maxCitations);
}

async function collectWindowCitedItems(
	topicId: string,
	topic: TopicPreset,
	lang: TranslationLanguage,
	window: SummaryWindow
): Promise<CitedItem[]> {
	const profile = SUMMARY_WINDOW_PROFILES[window];
	if (profile.historyItemsPerSourcePerDay === undefined) {
		return collectCitedItems(await getTrendsPage(topicId, lang));
	}
	const sourceIds = topic.sections.flatMap((section) => section.sourceIds);
	const history = await readSourceItemHistory(
		sourceIds,
		Date.now() - profile.windowMs,
		profile.historyItemsPerSourcePerDay
	);
	return selectCitedItems(
		collectHistoryCandidates(topic, history, profile.itemsPerSource),
		profile.maxCitations
	);
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
	lang: TranslationLanguage = "en",
	window: SummaryWindow = "today"
): string {
	const lines: string[] = [];
	lines.push(`Prompt version: ${SUMMARY_PROMPT_VERSION}`);
	lines.push(`Window: ${window}`);
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

export function buildSystemPrompt(
	lang: TranslationLanguage,
	window: SummaryWindow = "today"
): string {
	const profile = SUMMARY_LANGUAGE_PROFILES[lang];
	const period = SUMMARY_WINDOW_PROFILES[window].editorialPeriod;
	const recencyRule =
		window === "today"
			? "- Prefer the newest items. Skip promotions, ticket sales, job posts, and pure opinion pieces."
			: "- Judge importance over the whole period, not recency: a major story from early in the period beats a minor one from today. Skip promotions, ticket sales, job posts, and pure opinion pieces.";
	return [
		"You are the editor of OpenTrends, a dashboard of first-hand tech sources.",
		`From the numbered items the user gives you, pick the 10 things most worth knowing ${period}.`,
		"Rules:",
		"- Merge items that report the same story into one entry and cite all of them. A story covered by several sources matters more.",
		recencyRule,
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
	cached: Awaited<ReturnType<typeof readSummary>>,
	window: SummaryWindow
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
		staleUntil: cached.createdAt + SUMMARY_WINDOW_PROFILES[window].staleMs,
		text: cached.text,
	};
}

async function readAnyCachedSummary(
	topicId: string,
	lang: TranslationLanguage,
	window: SummaryWindow
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
			const entry = cachedSummaryToEntry(cached, window);
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
	lang: TranslationLanguage,
	window: SummaryWindow
): Promise<void> {
	if (!env.LLM_API_KEY) {
		throw new TrendsSummaryNotConfiguredError();
	}
	const topic = getTopicPreset(topicId);
	if (!topic) {
		throw new TopicNotFoundError(topicId);
	}
	const cacheTopicId = summaryCacheTopicId(topicId, window);
	const cited = await collectWindowCitedItems(topicId, topic, lang, window);
	const citations: Citation[] = cited.map(({ n, item }) => ({
		n,
		url: item.url,
	}));
	const prompt = buildPrompt(topic, cited, lang, window);
	const cached = await readSummaryWithTimeout(cacheTopicId, lang);
	const cachedEntry = cachedSummaryToEntry(cached, window);
	if (cachedEntry && cachedEntry.prompt === prompt) {
		hydrateMemorySummary(cacheTopicId, lang, cachedEntry);
		await writeHotSummaryCache(cacheTopicId, lang, cachedEntry);
		return;
	}

	const controller = new AbortController();
	for (let attempt = 0; attempt <= SUMMARY_LANGUAGE_RETRY_LIMIT; attempt += 1) {
		for await (const _chunk of streamGeneratedSummary({
			cacheTopicId,
			citations,
			cited,
			lang,
			prompt,
			topic,
			window,
			abortSignal: controller.signal,
		})) {
			// Consume the generator so it can write the completed summary to cache.
		}
		// A summary in the wrong language is never cached, so a missing entry
		// here means the attempt has to be repeated.
		if (readMemorySummary(cacheTopicId, lang)?.prompt === prompt) {
			return;
		}
	}
}

function startSummaryRefresh(
	topicId: string,
	lang: TranslationLanguage,
	window: SummaryWindow
): Promise<void> {
	const cacheKey = makeSummaryCacheKey(
		summaryCacheTopicId(topicId, window),
		lang
	);
	const inFlight = inFlightSummaryRefreshes.get(cacheKey);
	if (inFlight) {
		return inFlight;
	}
	const refresh = (async () => {
		try {
			await refreshSummaryCache(topicId, lang, window);
		} finally {
			inFlightSummaryRefreshes.delete(cacheKey);
		}
	})();
	inFlightSummaryRefreshes.set(cacheKey, refresh);
	return refresh;
}

export function refreshTrendsSummaryCache(
	topicId: string,
	lang: TranslationLanguage,
	window: SummaryWindow = "today"
): Promise<void> {
	return startSummaryRefresh(topicId, lang, window);
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
	window: SummaryWindow;
}): Promise<void> {
	const now = Date.now();
	const profile = SUMMARY_WINDOW_PROFILES[params.window];
	const entry: CachedSummaryEntry = {
		citations: params.citations,
		expiresAt: now + profile.ttlMs,
		prompt: params.prompt,
		staleUntil: now + profile.staleMs,
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
				ttlMs: profile.ttlMs,
			}),
			SUMMARY_CACHE_WRITE_TIMEOUT_MS,
			"Timed out writing cached trends summary."
		);
	} catch (error) {
		console.warn("[trends-summary] failed to write cached summary", error);
	}
}

// Body format for clients that ask for it: one JSON line carrying every
// citation, then the Markdown. A response header cannot hold the citation
// lists of the longer windows.
export async function* withCitationPreamble(
	citations: Citation[],
	stream: AsyncGenerator<string, void, void>
): AsyncGenerator<string, void, void> {
	yield `${JSON.stringify({ citations })}\n`;
	yield* stream;
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
	cacheTopicId: string;
	citations: Citation[];
	cited: CitedItem[];
	lang: TranslationLanguage;
	prompt: string;
	topic: TopicPreset;
	window: SummaryWindow;
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
		// streamText reports provider failures through onError and then simply
		// ends the text stream, so a rejected key would otherwise look like an
		// empty summary.
		let providerError: unknown;
		const result = streamText({
			abortSignal: params.abortSignal,
			model: trackSiliconFlowModel(
				provider(env.LLM_MODEL),
				"summary",
				env.LLM_BASE_URL
			),
			onError: ({ error }) => {
				providerError = error;
			},
			providerOptions: llmProviderOptions(),
			system: buildSystemPrompt(params.lang, params.window),
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
		if (!text) {
			throw providerError ?? new Error("The model returned an empty summary.");
		}
		if (isWrittenInTargetLanguage(text, params.lang)) {
			await writeCachedSummary({
				citations: params.citations,
				lang: params.lang,
				prompt: params.prompt,
				text,
				topicId: params.cacheTopicId,
				window: params.window,
			});
		} else {
			console.warn(
				`[trends-summary] discarded ${params.cacheTopicId} summary not written in ${params.lang}`
			);
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
	const window = options.window ?? "today";
	const cacheTopicId = summaryCacheTopicId(topicId, window);

	const cachedSummary = await readAnyCachedSummary(cacheTopicId, lang, window);
	if (cachedSummary) {
		if (cachedSummary.expiresAt <= Date.now()) {
			refreshSummaryInBackground(
				startSummaryRefresh(topicId, lang, window),
				options.waitUntil
			);
		}
		return {
			citations: cachedSummary.citations,
			stream: (abortSignal) =>
				replayCachedSummary(cachedSummary.text, abortSignal),
		};
	}

	const cited = await collectWindowCitedItems(topicId, topic, lang, window);
	const citations: Citation[] = cited.map(({ n, item }) => ({
		n,
		url: item.url,
	}));
	const prompt = buildPrompt(topic, cited, lang, window);

	return {
		citations,
		stream: (abortSignal) =>
			streamGeneratedSummary({
				cacheTopicId,
				citations,
				cited,
				lang,
				prompt,
				topic,
				window,
				abortSignal,
			}),
	};
}
