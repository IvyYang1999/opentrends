import type { Locale } from "@/lib/i18n";

import type { NewsItem, TrendsPageData } from "./types";

const CACHE_VERSION = 1;
const MAX_CACHED_TRANSLATIONS = 1800;
const STORAGE_KEY_PREFIX = "opentrends:trends:translations";

interface CachedTranslation {
	description?: string;
	itemId: string;
	originalDescription?: string;
	originalTitle: string;
	sourceId: string;
	title: string;
}

interface TranslationCacheEnvelope {
	items: CachedTranslation[];
	version: typeof CACHE_VERSION;
}

function storageKey(topicId: string, locale: Locale): string {
	return `${STORAGE_KEY_PREFIX}:${CACHE_VERSION}:${topicId}:${locale}`;
}

function browserStorage(): Storage | undefined {
	if (typeof window === "undefined") {
		return;
	}
	return window.localStorage;
}

function readTranslations(
	topicId: string,
	locale: Locale,
	storage = browserStorage()
): CachedTranslation[] {
	if (!storage) {
		return [];
	}
	try {
		const raw = storage.getItem(storageKey(topicId, locale));
		if (!raw) {
			return [];
		}
		const parsed = JSON.parse(raw) as Partial<TranslationCacheEnvelope>;
		return parsed.version === CACHE_VERSION && Array.isArray(parsed.items)
			? parsed.items
			: [];
	} catch {
		return [];
	}
}

function cacheEntry(item: NewsItem): CachedTranslation | undefined {
	if (!item.original) {
		return;
	}
	return {
		description: item.description,
		itemId: item.id,
		originalDescription: item.original.description,
		originalTitle: item.original.title,
		sourceId: item.sourceId,
		title: item.title,
	};
}

export function storePageTranslations(
	page: TrendsPageData,
	locale: Locale,
	storage = browserStorage()
): void {
	if (!storage) {
		return;
	}
	const items = page.sections
		.flatMap((section) => section.sources)
		.flatMap((source) => source.items)
		.map(cacheEntry)
		.filter((entry): entry is CachedTranslation => Boolean(entry))
		.slice(0, MAX_CACHED_TRANSLATIONS);
	if (items.length === 0) {
		return;
	}
	try {
		storage.setItem(
			storageKey(page.id, locale),
			JSON.stringify({ items, version: CACHE_VERSION })
		);
	} catch {
		// Storage can be disabled or full; the server-side D1 cache remains valid.
	}
}

export function applyCachedTranslations(
	page: TrendsPageData,
	locale: Locale,
	storage = browserStorage()
): TrendsPageData {
	const cached = new Map(
		readTranslations(page.id, locale, storage).map((entry) => [
			`${entry.sourceId}:${entry.itemId}`,
			entry,
		])
	);
	if (cached.size === 0) {
		return page;
	}

	let changed = false;
	const sections = page.sections.map((section) => ({
		...section,
		sources: section.sources.map((source) => ({
			...source,
			items: source.items.map((item) => {
				if (item.original) {
					return item;
				}
				const translation = cached.get(`${source.sourceId}:${item.id}`);
				if (
					!translation ||
					translation.originalTitle !== item.title ||
					translation.originalDescription !== item.description
				) {
					return item;
				}
				changed = true;
				return {
					...item,
					description: translation.description,
					original: {
						description: item.description,
						title: item.title,
					},
					title: translation.title,
				};
			}),
		})),
	}));

	return changed ? { ...page, sections } : page;
}
