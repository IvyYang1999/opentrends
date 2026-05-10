import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { env } from "@opentrends/env/server";
import { streamText } from "ai";

import { isMissingCacheSchemaError } from "../cache/cache-errors";
import { type CacheEnvelope, hotCache } from "../cache/hot-cache";
import { readSummary, writeSummary } from "../cache/summary-cache";
import { getSourcePreset } from "../config/sources";
import { getTopicPreset } from "../config/topics";
import type { NewsItem, TopicPreset, TrendsPageData } from "../types";
import { getTrendsPage, TopicNotFoundError } from "./get-trends-page";
import type { TranslationLanguage } from "./translate-news-items";

const ITEMS_PER_SOURCE = 6;
// Hard cap on number of cited items per summary. Keeps the citation header
// well under common HTTP header limits and keeps the LLM prompt focused.
const MAX_CITATIONS = 60;
const SUMMARY_TTL_MS = 60 * 60 * 1000;
const SUMMARY_STALE_MS = 24 * 60 * 60 * 1000;
const SUMMARY_CACHE_RETENTION_MS = 7 * 24 * 60 * 60_000;
const SUMMARY_HOT_CACHE_SCHEMA_VERSION = 2;
const SUMMARY_PROMPT_VERSION = "summary-date-v1";
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

function collectCitedItems(page: TrendsPageData): CitedItem[] {
	const result: CitedItem[] = [];
	let n = 0;
	for (const section of page.sections) {
		for (const source of section.sources) {
			if (source.items.length === 0) {
				continue;
			}
			const preset = getSourcePreset(source.sourceId);
			const sourceLabel = preset?.name ?? source.title;
			const top = source.items.slice(0, ITEMS_PER_SOURCE);
			for (const item of top) {
				if (n >= MAX_CITATIONS) {
					return result;
				}
				n += 1;
				result.push({ n, source: sourceLabel, item });
			}
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

export function buildPrompt(topic: TopicPreset, cited: CitedItem[]): string {
	const lines: string[] = [];
	lines.push(`Prompt version: ${SUMMARY_PROMPT_VERSION}`);
	lines.push(`Topic: ${topic.title}`);
	if (topic.description) {
		lines.push(`Description: ${topic.description}`);
	}
	lines.push("");
	lines.push(
		"Numbered sources you may cite. Each line is `[N] [Source] (item date) Title — short description` (description shown when available). Prioritize newer dated items when identifying what changed or moved recently:"
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

	return lines.join("\n");
}

function buildSystemPrompt(lang: TranslationLanguage): string {
	if (lang === "zh") {
		return [
			"你是趋势新闻看板的编辑。",
			"根据下面带编号的信息源，写一段简短的中文总结，突出共同主题、值得关注的故事和真正有趣或重要的内容。",
			"每条信息源都带有日期；优先总结日期较新的条目，尽量说明最近更新、变化或新出现的内容，较早条目只作为背景。",
			"输出 Markdown：可以用 **加粗** 强调关键词；不要大标题（#），不要写「以下是总结」之类的开场白。",
			"重要：每当具体提到某条新闻时，**必须**在该断言或要点结尾追加来源编号，格式严格写作 `[N]`，N 是上面列表里的编号。例如：「OpenAI 推出了 GPT-5 [3][7]」。引用多条用 `[3][7]` 连写，不要写成 `[3, 7]`。",
			"只引用真实出现在编号列表里的 N，不要自创。如果某句没有具体来源，就不要加引用。",
		].join("\n");
	}
	if (lang === "zh-Hant") {
		return [
			"你是趨勢新聞看板的編輯。",
			"根據下面帶編號的資訊來源，寫一段簡短的繁體中文總結，突出共同主題、值得關注的故事和真正有趣或重要的內容。",
			"每則資訊來源都帶有日期；優先總結日期較新的項目，盡量說明最近更新、變化或新出現的內容，較早項目只作背景。",
			"輸出 Markdown：可以用 **粗體** 強調關鍵詞；不要大標題（#），不要寫「以下是總結」之類的開場白。",
			"重要：每當具體提到某則新聞時，**必須**在該斷言或要點結尾追加來源編號，格式嚴格寫作 `[N]`，N 是上面列表裡的編號。例如：「OpenAI 推出了 GPT-5 [3][7]」。引用多則用 `[3][7]` 連寫，不要寫成 `[3, 7]`。",
			"只引用真實出現在編號列表裡的 N，不要自創。如果某句沒有具體來源，就不要加引用。",
		].join("\n");
	}
	if (lang === "ru") {
		return [
			"Вы редактор панели технологических трендов.",
			"По пронумерованным заголовкам ниже напишите краткую сводку на русском языке: выделите общие темы, заметные сюжеты и действительно важные или неожиданные детали.",
			"У каждого источника есть дата; отдавайте приоритет более новым материалам и по возможности объясняйте, что недавно обновилось, изменилось или появилось. Более старые материалы используйте только как контекст.",
			"Отвечайте в Markdown: используйте **жирный** для акцентов; не добавляйте заголовки верхнего уровня (#) и вступления вроде «Вот сводка».",
			"ВАЖНО: когда ссылаетесь на конкретный материал, добавляйте номер источника в формате `[N]` в конце предложения или утверждения. Несколько источников пишите подряд, например `[3][7]`, а не `[3, 7]`.",
			"Цитируйте только номера, реально присутствующие в списке. Если предложение не привязано к конкретному материалу, не добавляйте ссылку.",
		].join("\n");
	}
	if (lang === "fr-FR") {
		return [
			"Vous êtes éditeur d'un tableau de bord des tendances technologiques.",
			"À partir des titres numérotés ci-dessous, rédigez un court résumé en français de France qui met en avant les thèmes communs, les histoires notables et les éléments vraiment surprenants ou importants.",
			"Chaque élément source inclut une date ; donnez la priorité aux éléments les plus récents et indiquez ce qui a changé, été mis à jour ou émergé récemment. Utilisez les éléments plus anciens seulement comme contexte.",
			"Répondez en Markdown : utilisez le **gras** pour les points clés ; évitez les titres de premier niveau (#) et les introductions comme « Voici un résumé ».",
			"IMPORTANT : quand vous mentionnez un élément précis, ajoutez une citation au format `[N]` à la fin de la phrase ou de l'affirmation. Pour plusieurs sources, écrivez-les côte à côte, par exemple `[3][7]`, pas `[3, 7]`.",
			"Ne citez que les numéros réellement présents dans la liste. Si une phrase n'est pas liée à un élément précis, n'ajoutez pas de citation.",
		].join("\n");
	}
	if (lang === "es-ES") {
		return [
			"Eres editor de un panel de tendencias tecnológicas.",
			"A partir de los titulares numerados de abajo, escribe un resumen breve en español de España que destaque temas comunes, historias relevantes y cualquier detalle realmente sorprendente o importante.",
			"Cada elemento de fuente incluye una fecha; da prioridad a los elementos más recientes y explica qué ha cambiado, se ha actualizado o ha aparecido últimamente. Usa los elementos antiguos solo como contexto.",
			"Responde en Markdown: usa **negrita** para enfatizar; evita encabezados de primer nivel (#) y entradas como «Aquí tienes un resumen».",
			"IMPORTANTE: cuando menciones un elemento concreto, añade una cita con el formato `[N]` al final de la frase o afirmación. Para varias fuentes, escríbelas juntas, por ejemplo `[3][7]`, no `[3, 7]`.",
			"Cita solo números que aparezcan realmente en la lista. Si una frase no está vinculada a un elemento concreto, no añadas cita.",
		].join("\n");
	}
	if (lang === "de-DE") {
		return [
			"Sie sind Redakteur eines Dashboards für Technologietrends.",
			"Schreiben Sie anhand der nummerierten Überschriften unten eine kurze Zusammenfassung auf Deutsch (Deutschland), die gemeinsame Themen, wichtige Geschichten und wirklich überraschende oder bedeutsame Details hervorhebt.",
			"Jedes Quellelement enthält ein Datum; priorisieren Sie neuere Einträge und erklären Sie nach Möglichkeit, was sich kürzlich geändert, aktualisiert oder neu ergeben hat. Ältere Einträge nur als Kontext verwenden.",
			"Antworten Sie in Markdown: Verwenden Sie **Fettdruck** für Akzente; vermeiden Sie Überschriften erster Ebene (#) und Einleitungen wie „Hier ist eine Zusammenfassung“.",
			"WICHTIG: Wenn Sie sich auf einen konkreten Eintrag beziehen, fügen Sie am Ende des Satzes oder der Aussage eine Quellenangabe im Format `[N]` hinzu. Mehrere Quellen direkt hintereinander schreiben, z. B. `[3][7]`, nicht `[3, 7]`.",
			"Zitieren Sie nur Nummern, die tatsächlich in der Liste vorkommen. Wenn ein Satz nicht an einen konkreten Eintrag gebunden ist, lassen Sie die Quellenangabe weg.",
		].join("\n");
	}
	if (lang === "pt-BR") {
		return [
			"Você é editor de um painel de tendências de tecnologia.",
			"Com base nas manchetes numeradas abaixo, escreva um resumo curto em português do Brasil destacando temas comuns, histórias relevantes e qualquer detalhe realmente surpreendente ou importante.",
			"Cada item de fonte inclui uma data; priorize itens mais recentes e explique o que mudou, foi atualizado ou surgiu recentemente. Use itens mais antigos apenas como contexto.",
			"Responda em Markdown: use **negrito** para dar ênfase; evite títulos de primeiro nível (#) e aberturas como «Aqui está um resumo».",
			"IMPORTANTE: sempre que mencionar um item específico, adicione uma citação no formato `[N]` ao final da frase ou afirmação. Para várias fontes, escreva-as juntas, por exemplo `[3][7]`, não `[3, 7]`.",
			"Cite apenas números que realmente aparecem na lista. Se uma frase não estiver ligada a um item específico, não adicione citação.",
		].join("\n");
	}
	return [
		"You are an editor for a trending tech news dashboard.",
		"Given the numbered headlines below, write a short summary that highlights common themes, notable stories, and anything genuinely surprising or significant.",
		"Each source item includes a date; prioritize newer dated items and call out what recently changed, updated, or emerged. Use older items only as context.",
		"Respond in Markdown: use **bold** to emphasize key terms; Avoid top-level headings (#) and no preamble like 'Here is a summary'.",
		"IMPORTANT: whenever you reference a specific item, append a citation tag in the form `[N]` (where N is the index from the list above), placed at the end of the sentence or claim. To cite multiple sources, write them adjacent like `[3][7]`, not `[3, 7]`.",
		"Only cite numbers that actually appear in the list. If a sentence isn't tied to a specific item, omit the citation.",
	].join("\n");
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
		if (
			!(
				isMissingCacheSchemaError(error) ||
				error instanceof SummaryCacheReadTimeoutError
			)
		) {
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
	const prompt = buildPrompt(topic, cited);
	const cached = await readSummaryWithTimeout(topicId, lang);
	const cachedEntry = cachedSummaryToEntry(cached);
	if (cachedEntry && cachedEntry.prompt === prompt) {
		hydrateMemorySummary(topicId, lang, cachedEntry);
		await writeHotSummaryCache(topicId, lang, cachedEntry);
		return;
	}

	const controller = new AbortController();
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
		if (!isMissingCacheSchemaError(error)) {
			console.warn("[trends-summary] failed to write cached summary", error);
		}
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
	});
	const chunks: string[] = [];
	let iterator: AsyncIterator<string> | undefined;
	try {
		const result = streamText({
			abortSignal: params.abortSignal,
			model: provider(env.LLM_MODEL),
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
		if (text) {
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
	const prompt = buildPrompt(topic, cited);

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
