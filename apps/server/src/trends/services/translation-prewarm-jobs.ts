import { getWorkerBindings } from "../../runtime";
import { hotCache } from "../cache/hot-cache";
import { readSnapshot } from "../cache/source-cache";
import type { NewsItem, SourceId, TrendsPageData } from "../types";
import { invalidateTranslatedTrendsPageCache } from "./get-trends-page";
import {
	isTranslationConfigured,
	needsTranslation,
	prewarmItemTranslations,
	type TranslationLanguage,
} from "./translate-news-items";

// Readers should find titles in their language on the first paint, not after
// their own visit has paid for the translation. Languages are limited to the
// two the audience reads most, because every language multiplies model cost.
export const TRANSLATION_PREWARM_LANGUAGES: readonly TranslationLanguage[] = [
	"zh",
	"en",
];

export interface TranslationPrewarmMessage {
	/** When set, only these items of the source are translated: a page view
	 * in a language nobody prewarms pays for what it shows, not the whole
	 * snapshot. */
	itemIds?: string[];
	lang: TranslationLanguage;
	sourceId: SourceId;
}

const REQUEST_PREWARM_COOLDOWN_MS = 15 * 60_000;
const REQUEST_PREWARM_LIMIT = 24;
// Page views in other languages share the queue with everything else, so
// they take fewer slots per view.
const REQUEST_PREWARM_LIMIT_OTHER_LANGUAGES = 8;
// A Worker keeps running about 30s past its response; the inline pass has
// to fit inside that, batches still in flight at the deadline may finish.
const REQUEST_TRANSLATION_TIMEOUT_MS = 20_000;

function isPrewarmLanguage(lang: TranslationLanguage): boolean {
	return TRANSLATION_PREWARM_LANGUAGES.includes(lang);
}

function requestMarkerKey(message: TranslationPrewarmMessage): string {
	return `trends:v1:translation-prewarm-request:${message.sourceId}:${message.lang}`;
}

async function clearRequestMarker(
	message: TranslationPrewarmMessage
): Promise<void> {
	await hotCache.delete(requestMarkerKey(message));
}

async function reserveRequestMarker(
	message: TranslationPrewarmMessage
): Promise<boolean> {
	const now = Date.now();
	const key = requestMarkerKey(message);
	const existing = await hotCache.get<boolean>(key);
	if (existing && existing.freshUntil > now) {
		return false;
	}
	await hotCache.put(
		key,
		{
			createdAt: now,
			freshUntil: now + REQUEST_PREWARM_COOLDOWN_MS,
			schemaVersion: 1,
			staleUntil: now + REQUEST_PREWARM_COOLDOWN_MS,
			value: true,
		},
		Math.ceil(REQUEST_PREWARM_COOLDOWN_MS / 1000)
	);
	return true;
}

// Scheduled prewarm covers TRANSLATION_PREWARM_LANGUAGES; a page view in
// any other locale still requests its own translations, so a German reader
// is not left with Chinese headlines. The cost only arises when someone
// actually reads in that language.
export function translationPrewarmMessagesForPage(
	page: TrendsPageData,
	lang: TranslationLanguage
): TranslationPrewarmMessage[] {
	const messages = new Map<SourceId, TranslationPrewarmMessage>();
	for (const section of page.sections) {
		for (const source of section.sources) {
			const itemIds = source.items
				.filter((item) => needsTranslation(item, lang))
				.map((item) => item.id);
			if (itemIds.length > 0 && !messages.has(source.sourceId)) {
				messages.set(
					source.sourceId,
					isPrewarmLanguage(lang)
						? { lang, sourceId: source.sourceId }
						: { itemIds, lang, sourceId: source.sourceId }
				);
			}
		}
	}
	return [...messages.values()];
}

export async function runTranslationPrewarmJob(
	message: TranslationPrewarmMessage
): Promise<void> {
	const snapshot = await readSnapshot(message.sourceId);
	if (!snapshot || snapshot.items.length === 0) {
		await clearRequestMarker(message);
		return;
	}
	const wanted = message.itemIds ? new Set(message.itemIds) : undefined;
	const items = wanted
		? snapshot.items.filter((item) => wanted.has(item.id))
		: snapshot.items;
	const translated = await prewarmItemTranslations(items, message.lang);
	if (translated > 0) {
		await invalidateTranslatedTrendsPageCache(message.sourceId, message.lang);
		console.info(
			`[trends-translation] prewarmed ${translated} ${message.lang} items for ${message.sourceId}`
		);
	}
	await clearRequestMarker(message);
}

async function sendToCloudflareQueue(
	message: TranslationPrewarmMessage
): Promise<boolean> {
	// Shares the summary prewarm queue: both are low-priority model work that
	// follows a source refresh, and a second queue would need new infrastructure.
	const queue = getWorkerBindings()?.SUMMARY_PREWARM_QUEUE;
	if (!queue) {
		return false;
	}
	try {
		await queue.send({ kind: "translation-prewarm", payload: message });
		return true;
	} catch (error) {
		console.warn(
			"[trends-translation] Cloudflare queue dispatch failed",
			error
		);
		return false;
	}
}

// Called after a source refresh with its current items. Cached items are
// skipped inside the job, while passing the whole snapshot makes provider
// outages self-healing on the next refresh even when the source did not change.
export async function dispatchTranslationPrewarmJobs(
	sourceId: SourceId,
	changedItems: NewsItem[]
): Promise<void> {
	if (!isTranslationConfigured()) {
		return;
	}
	for (const lang of TRANSLATION_PREWARM_LANGUAGES) {
		if (!changedItems.some((item) => needsTranslation(item, lang))) {
			continue;
		}
		const message = { lang, sourceId };
		if (!(await sendToCloudflareQueue(message))) {
			await runTranslationPrewarmJob(message);
		}
	}
}

// Chinese and English readers are waiting on the page they just opened, so
// their missing titles are translated right here, in the request's
// background time, instead of queueing behind other languages' work. The
// page's own items are enough: the scheduled prewarm covers the rest.
async function translatePageInline(
	page: TrendsPageData,
	lang: TranslationLanguage,
	messages: TranslationPrewarmMessage[]
): Promise<number> {
	const reserved: TranslationPrewarmMessage[] = [];
	for (const message of messages) {
		if (reserved.length >= REQUEST_PREWARM_LIMIT) {
			break;
		}
		if (await reserveRequestMarker(message)) {
			reserved.push(message);
		}
	}
	if (reserved.length === 0) {
		return 0;
	}
	const sourceIds = new Set(reserved.map((message) => message.sourceId));
	const items: NewsItem[] = page.sections
		.flatMap((section) => section.sources)
		.filter((source) => sourceIds.has(source.sourceId))
		.flatMap((source) => source.items);
	try {
		const translated = await prewarmItemTranslations(items, lang, {
			timeoutMs: REQUEST_TRANSLATION_TIMEOUT_MS,
		});
		if (translated > 0) {
			await Promise.all(
				[...sourceIds].map((sourceId) =>
					invalidateTranslatedTrendsPageCache(sourceId, lang)
				)
			);
			console.info(
				`[trends-translation] translated ${translated} ${lang} items for ${page.id} on request`
			);
		}
	} catch (error) {
		console.warn("[trends-translation] request translation failed", error);
	} finally {
		await Promise.all(reserved.map((message) => clearRequestMarker(message)));
	}
	return reserved.length;
}

export async function requestTranslationPrewarmsForPage(
	page: TrendsPageData,
	lang: TranslationLanguage
): Promise<number> {
	const messages = translationPrewarmMessagesForPage(page, lang);
	if (isPrewarmLanguage(lang)) {
		return translatePageInline(page, lang, messages);
	}
	let dispatched = 0;
	for (const message of messages) {
		if (dispatched >= REQUEST_PREWARM_LIMIT_OTHER_LANGUAGES) {
			break;
		}
		if (!(await reserveRequestMarker(message))) {
			continue;
		}
		try {
			if (!(await sendToCloudflareQueue(message))) {
				await runTranslationPrewarmJob(message);
			}
			dispatched += 1;
		} catch (error) {
			await clearRequestMarker(message);
			console.warn("[trends-translation] request prewarm failed", error);
		}
	}
	return dispatched;
}
