import { env } from "@opentrends/env/web";

import type { Locale } from "@/lib/i18n";

import type { SourceCardData, TrendsPageData } from "./types";

const TRENDS_FETCH_TIMEOUT_MS = 25_000;
const TRENDS_TRANSLATION_FETCH_TIMEOUT_MS = 25_000;
export const TRENDS_PREVIEW_ITEMS_PER_SOURCE = 16;
export const TRENDS_FULL_ITEMS_PER_SOURCE = 30;

export type TranslationLoadMode = "background" | "sync";

export class TrendsTopicNotFoundError extends Error {
	constructor(topic: string) {
		super(`Unknown trends topic: ${topic}`);
		this.name = "TrendsTopicNotFoundError";
	}
}

function getRequestCacheOption(
	translationMode: TranslationLoadMode
): RequestCache | undefined {
	return translationMode === "sync" ? "no-store" : undefined;
}

export async function loadTrends(
	topic?: string,
	locale: Locale = "en",
	translationMode: TranslationLoadMode = "background",
	itemsPerSource = TRENDS_FULL_ITEMS_PER_SOURCE
): Promise<TrendsPageData> {
	const path = topic
		? `/api/trends/${encodeURIComponent(topic)}`
		: "/api/trends";
	const search = new URLSearchParams({
		items: String(itemsPerSource),
		lang: locale,
		translations: translationMode,
	});
	if (translationMode === "sync") {
		search.set("_", String(Date.now()));
	}
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), TRENDS_FETCH_TIMEOUT_MS);
	let response: Response;
	try {
		response = await fetch(`${env.VITE_SERVER_URL}${path}?${search}`, {
			cache: getRequestCacheOption(translationMode),
			credentials: "omit",
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timeout);
	}
	if (response.status === 404) {
		throw new TrendsTopicNotFoundError(topic ?? "ai");
	}
	if (!response.ok) {
		throw new Error(`Failed to load trends page (${response.status})`);
	}
	return (await response.json()) as TrendsPageData;
}

export async function loadTrendSource(
	topic: string,
	sourceId: string,
	locale: Locale = "en",
	translationMode: TranslationLoadMode = "background",
	itemsPerSource = TRENDS_FULL_ITEMS_PER_SOURCE
): Promise<SourceCardData> {
	const search = new URLSearchParams({
		items: String(itemsPerSource),
		lang: locale,
		translations: translationMode,
	});
	if (translationMode === "sync") {
		search.set("_", String(Date.now()));
	}
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), TRENDS_FETCH_TIMEOUT_MS);
	let response: Response;
	try {
		response = await fetch(
			`${env.VITE_SERVER_URL}/api/trends/${encodeURIComponent(topic)}/sources/${encodeURIComponent(sourceId)}?${search}`,
			{
				cache: getRequestCacheOption(translationMode),
				credentials: "omit",
				signal: controller.signal,
			}
		);
	} finally {
		clearTimeout(timeout);
	}
	if (!response.ok) {
		throw new Error(`Failed to load trend source (${response.status})`);
	}
	return (await response.json()) as SourceCardData;
}

export async function translateTrendsPageSnapshot(
	page: TrendsPageData,
	locale: Locale
): Promise<TrendsPageData> {
	const search = new URLSearchParams({
		lang: locale,
		_: String(Date.now()),
	});
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(),
		TRENDS_TRANSLATION_FETCH_TIMEOUT_MS
	);
	let response: Response;
	try {
		response = await fetch(
			`${env.VITE_SERVER_URL}/api/trends/${encodeURIComponent(page.id)}/translations?${search}`,
			{
				body: JSON.stringify(page),
				cache: "no-store",
				credentials: "omit",
				headers: {
					"Content-Type": "application/json",
				},
				method: "POST",
				signal: controller.signal,
			}
		);
	} finally {
		clearTimeout(timeout);
	}
	if (!response.ok) {
		throw new Error(`Failed to translate trends page (${response.status})`);
	}
	return (await response.json()) as TrendsPageData;
}
