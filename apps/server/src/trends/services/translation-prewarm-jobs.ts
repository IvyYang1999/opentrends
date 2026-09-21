import { getWorkerBindings } from "../../runtime";
import { readSnapshot } from "../cache/source-cache";
import type { NewsItem, SourceId } from "../types";
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

export async function runTranslationPrewarmJob(
	message: TranslationPrewarmMessage
): Promise<void> {
	const snapshot = await readSnapshot(message.sourceId);
	if (!snapshot || snapshot.items.length === 0) {
		return;
	}
	const translated = await prewarmItemTranslations(
		snapshot.items,
		message.lang
	);
	if (translated > 0) {
		console.info(
			`[trends-translation] prewarmed ${translated} ${message.lang} items for ${message.sourceId}`
		);
	}
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

// Called after a source refresh with the items that are new or changed. A job
// is only queued for a language those items actually need, so an English feed
// never costs an English job and an unchanged feed costs nothing.
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
