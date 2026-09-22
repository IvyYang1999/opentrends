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
	lang: TranslationLanguage;
	sourceId: SourceId;
}

const REQUEST_PREWARM_COOLDOWN_MS = 15 * 60_000;
const REQUEST_PREWARM_LIMIT = 24;

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

export function translationPrewarmMessagesForPage(
	page: TrendsPageData,
	lang: TranslationLanguage
): TranslationPrewarmMessage[] {
	if (!(TRANSLATION_PREWARM_LANGUAGES as readonly string[]).includes(lang)) {
		return [];
	}
	const sourceIds = new Set<SourceId>();
	for (const section of page.sections) {
		for (const source of section.sources) {
			if (source.items.some((item) => needsTranslation(item, lang))) {
				sourceIds.add(source.sourceId);
			}
		}
	}
	return [...sourceIds].map((sourceId) => ({ lang, sourceId }));
}

export async function runTranslationPrewarmJob(
	message: TranslationPrewarmMessage
): Promise<void> {
	const snapshot = await readSnapshot(message.sourceId);
	if (!snapshot || snapshot.items.length === 0) {
		await clearRequestMarker(message);
		return;
	}
	const translated = await prewarmItemTranslations(
		snapshot.items,
		message.lang
	);
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

export async function requestTranslationPrewarmsForPage(
	page: TrendsPageData,
	lang: TranslationLanguage
): Promise<number> {
	let dispatched = 0;
	for (const message of translationPrewarmMessagesForPage(page, lang)) {
		if (dispatched >= REQUEST_PREWARM_LIMIT) {
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
