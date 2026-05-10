import { type CacheEnvelope, hotCache } from "../cache/hot-cache";
import { readSnapshot, readSnapshots } from "../cache/source-cache";
import { getSourcePreset } from "../config/sources";
import { getTopicPreset } from "../config/topics";
import type {
	SourceCardData,
	SourceId,
	SourceSnapshot,
	TopicId,
	TrendsPageData,
	TrendsSectionData,
} from "../types";
import { refreshSource } from "./refresh-source";
import {
	type TranslationLanguage,
	type TranslationMode,
	translateTrendsPage,
} from "./translate-news-items";

export type TrendsPageCacheStatus =
	| "bypass"
	| "hit"
	| "in-flight"
	| "miss"
	| "stale";

const TRENDS_PAGE_CACHE_FRESH_MS = 15 * 60_000;
const TRENDS_PAGE_CACHE_STALE_MS = 6 * 60 * 60_000;
const TRENDS_PAGE_CACHE_RETENTION_MS = 7 * 24 * 60 * 60_000;
const TRENDS_PAGE_HOT_CACHE_SCHEMA_VERSION = 1;
const TRENDS_PAGE_HOT_CACHE_TTL_SECONDS = Math.ceil(
	TRENDS_PAGE_CACHE_RETENTION_MS / 1000
);
const NO_SNAPSHOT_MESSAGE = "Source has no snapshot yet.";
export const DEFAULT_TRENDS_ITEMS_PER_SOURCE = 30;
export const PREVIEW_TRENDS_ITEMS_PER_SOURCE = 16;
const memoryTrendsPageCache = new Map<
	string,
	{ freshUntil: number; page: TrendsPageData; staleUntil: number }
>();
const inFlightTrendsPageRefreshes = new Map<string, Promise<TrendsPageData>>();

interface TrendsPageCacheOptions {
	waitUntil?: (promise: Promise<unknown>) => void;
}

export function clearTrendsPageCache(): void {
	memoryTrendsPageCache.clear();
	inFlightTrendsPageRefreshes.clear();
}

export class TopicNotFoundError extends Error {
	constructor(topic: string) {
		super(`Unknown trends topic: ${topic}`);
		this.name = "TopicNotFoundError";
	}
}

export class TrendsSnapshotsUnavailableError extends Error {
	constructor(cause: unknown) {
		super("Trends source snapshots are temporarily unavailable.");
		this.name = "TrendsSnapshotsUnavailableError";
		this.cause = cause;
	}
}

function isCacheableTrendsPageMode(translationMode: TranslationMode): boolean {
	return translationMode === "background";
}

function isMemoryCacheableTrendsPage(
	_lang: TranslationLanguage,
	translationMode: TranslationMode
): boolean {
	return translationMode === "background";
}

function makeTrendsPageCacheKey(
	topicId: string,
	lang: TranslationLanguage,
	translationMode: TranslationMode,
	itemsPerSource: number
): string {
	return `trends:v4:page:${topicId}:${lang}:${translationMode}:${itemsPerSource}`;
}

function writeMemoryTrendsPageCache(
	cacheKey: string,
	page: TrendsPageData,
	freshUntil: number,
	staleUntil: number,
	lang: TranslationLanguage,
	translationMode: TranslationMode
): void {
	if (!isMemoryCacheableTrendsPage(lang, translationMode)) {
		return;
	}
	memoryTrendsPageCache.set(cacheKey, {
		freshUntil,
		page,
		staleUntil,
	});
}

function hydrateMemoryTrendsPageCache(
	cacheKey: string,
	envelope: CacheEnvelope<TrendsPageData>,
	lang: TranslationLanguage,
	translationMode: TranslationMode
): void {
	writeMemoryTrendsPageCache(
		cacheKey,
		envelope.value,
		envelope.freshUntil,
		envelope.staleUntil,
		lang,
		translationMode
	);
}

async function readHotTrendsPageCache(
	cacheKey: string
): Promise<CacheEnvelope<TrendsPageData> | null> {
	const envelope = await hotCache.get<TrendsPageData>(cacheKey);
	if (
		!envelope ||
		envelope.schemaVersion !== TRENDS_PAGE_HOT_CACHE_SCHEMA_VERSION
	) {
		return null;
	}
	return envelope;
}

async function startTrendsPageRefresh(
	cacheKey: string,
	topicId: string,
	lang: TranslationLanguage,
	translationMode: TranslationMode,
	itemsPerSource: number
): Promise<TrendsPageData> {
	const inFlight = inFlightTrendsPageRefreshes.get(cacheKey);
	if (inFlight) {
		return inFlight;
	}

	const refresh = refreshTrendsPage(
		cacheKey,
		topicId,
		lang,
		translationMode,
		itemsPerSource
	);
	inFlightTrendsPageRefreshes.set(cacheKey, refresh);
	try {
		return await refresh;
	} finally {
		inFlightTrendsPageRefreshes.delete(cacheKey);
	}
}

async function refreshTrendsPage(
	cacheKey: string,
	topicId: string,
	lang: TranslationLanguage,
	translationMode: TranslationMode,
	itemsPerSource: number
): Promise<TrendsPageData> {
	const page = await buildTrendsPage(
		topicId,
		lang,
		translationMode,
		itemsPerSource
	);
	if (!hasMissingSnapshots(page)) {
		const now = Date.now();
		const freshUntil = now + TRENDS_PAGE_CACHE_FRESH_MS;
		const staleUntil = now + TRENDS_PAGE_CACHE_STALE_MS;
		writeMemoryTrendsPageCache(
			cacheKey,
			page,
			freshUntil,
			staleUntil,
			lang,
			translationMode
		);
		await hotCache.put<TrendsPageData>(
			cacheKey,
			{
				createdAt: now,
				freshUntil,
				schemaVersion: TRENDS_PAGE_HOT_CACHE_SCHEMA_VERSION,
				staleUntil,
				value: page,
			},
			TRENDS_PAGE_HOT_CACHE_TTL_SECONDS
		);
	}
	return page;
}

function hasMissingSnapshots(page: TrendsPageData): boolean {
	return getMissingSnapshotSourceIds(page).length > 0;
}

function getMissingSnapshotSourceIds(page: TrendsPageData): SourceId[] {
	const missing = new Set<SourceId>();
	for (const section of page.sections) {
		for (const source of section.sources) {
			if (source.errorMessage === NO_SNAPSHOT_MESSAGE) {
				missing.add(source.sourceId);
			}
		}
	}
	return [...missing];
}

function refreshMissingSnapshotsInBackground(
	page: TrendsPageData,
	waitUntil: TrendsPageCacheOptions["waitUntil"]
): void {
	const sourceIds = getMissingSnapshotSourceIds(page);
	if (sourceIds.length === 0) {
		return;
	}

	const refresh = (async () => {
		let refreshed = false;
		for (const sourceId of sourceIds) {
			const outcome = await refreshSource(sourceId);
			if (outcome.kind === "ok" || outcome.kind === "error") {
				refreshed = true;
			}
		}
		if (refreshed) {
			clearTrendsPageCache();
		}
	})();
	const observedRefresh = refresh.catch((error) => {
		console.warn("[trends-page] missing source refresh failed", error);
	});
	if (waitUntil) {
		waitUntil(observedRefresh);
	}
}

function refreshTrendsPageInBackground(
	refresh: Promise<TrendsPageData>,
	waitUntil: TrendsPageCacheOptions["waitUntil"]
): void {
	const observedRefresh = refresh.catch((error) => {
		console.warn("[trends-page] background refresh failed", error);
	});
	if (waitUntil) {
		waitUntil(observedRefresh);
	}
}

function snapshotToCard(
	sourceId: SourceId,
	snapshot: SourceSnapshot | null,
	itemsPerSource: number
): SourceCardData {
	const preset = getSourcePreset(sourceId);
	const title = preset?.name ?? sourceId;
	const homeUrl = preset?.homeUrl;

	if (!snapshot) {
		return {
			sourceId,
			title,
			homeUrl,
			status: "error",
			errorMessage: NO_SNAPSHOT_MESSAGE,
			items: [],
		};
	}

	const items = snapshot.items.slice(0, itemsPerSource);
	return {
		sourceId,
		title,
		homeUrl,
		status: snapshot.status,
		updatedAt: snapshot.fetchedAt,
		errorMessage: snapshot.lastError,
		itemCount: snapshot.items.length,
		items,
		itemsTruncated: items.length < snapshot.items.length,
	};
}

async function buildTrendsPage(
	topicId: string,
	lang: TranslationLanguage = "en",
	translationMode: TranslationMode = "background",
	itemsPerSource = DEFAULT_TRENDS_ITEMS_PER_SOURCE
): Promise<TrendsPageData> {
	const topic = getTopicPreset(topicId);
	if (!topic) {
		throw new TopicNotFoundError(topicId);
	}

	const sourceIds = [
		...new Set(topic.sections.flatMap((section) => section.sourceIds)),
	];
	let snapshots: Map<SourceId, SourceSnapshot>;
	try {
		snapshots = await readSnapshots(sourceIds);
	} catch (error) {
		console.warn("[trends-page] failed to read source snapshots", error);
		throw new TrendsSnapshotsUnavailableError(error);
	}
	const sections: TrendsSectionData[] = [];
	for (const section of topic.sections) {
		const sources: SourceCardData[] = section.sourceIds.map((sourceId) =>
			snapshotToCard(sourceId, snapshots.get(sourceId) ?? null, itemsPerSource)
		);
		sections.push({ id: section.id, title: section.title, sources });
	}

	const page: TrendsPageData = {
		id: topicId as TopicId,
		title: topic.title,
		description: topic.description,
		updatedAt: Date.now(),
		sections,
	};
	return translateTrendsPage(page, lang, translationMode);
}

export async function getTrendsPageWithCacheInfo(
	topicId: string,
	lang: TranslationLanguage = "en",
	translationMode: TranslationMode = "background",
	itemsPerSource = DEFAULT_TRENDS_ITEMS_PER_SOURCE,
	options: TrendsPageCacheOptions = {}
): Promise<{ cacheStatus: TrendsPageCacheStatus; page: TrendsPageData }> {
	if (!isCacheableTrendsPageMode(translationMode)) {
		const page = await buildTrendsPage(
			topicId,
			lang,
			translationMode,
			itemsPerSource
		);
		refreshMissingSnapshotsInBackground(page, options.waitUntil);
		return {
			cacheStatus: "bypass",
			page,
		};
	}

	const now = Date.now();
	const cacheKey = makeTrendsPageCacheKey(
		topicId,
		lang,
		translationMode,
		itemsPerSource
	);
	const memoryCacheable = isMemoryCacheableTrendsPage(lang, translationMode);
	const cached = memoryCacheable
		? memoryTrendsPageCache.get(cacheKey)
		: undefined;
	if (cached && cached.freshUntil > now) {
		return { cacheStatus: "hit", page: cached.page };
	}

	if (cached) {
		refreshTrendsPageInBackground(
			startTrendsPageRefresh(
				cacheKey,
				topicId,
				lang,
				translationMode,
				itemsPerSource
			),
			options.waitUntil
		);
		return { cacheStatus: "stale", page: cached.page };
	}

	let hotCached: CacheEnvelope<TrendsPageData> | null = null;
	try {
		hotCached = await readHotTrendsPageCache(cacheKey);
	} catch (error) {
		console.warn("[trends-page] failed to read hot page cache", error);
	}
	if (hotCached && hotCached.freshUntil > now) {
		hydrateMemoryTrendsPageCache(cacheKey, hotCached, lang, translationMode);
		return { cacheStatus: "hit", page: hotCached.value };
	}

	if (hotCached) {
		hydrateMemoryTrendsPageCache(cacheKey, hotCached, lang, translationMode);
		refreshTrendsPageInBackground(
			startTrendsPageRefresh(
				cacheKey,
				topicId,
				lang,
				translationMode,
				itemsPerSource
			),
			options.waitUntil
		);
		return { cacheStatus: "stale", page: hotCached.value };
	}

	const refresh = startTrendsPageRefresh(
		cacheKey,
		topicId,
		lang,
		translationMode,
		itemsPerSource
	);
	const page = await refresh;
	refreshMissingSnapshotsInBackground(page, options.waitUntil);
	return { cacheStatus: "miss", page };
}

export async function getTrendsPage(
	topicId: string,
	lang: TranslationLanguage = "en",
	translationMode: TranslationMode = "background",
	itemsPerSource = DEFAULT_TRENDS_ITEMS_PER_SOURCE
): Promise<TrendsPageData> {
	const { page } = await getTrendsPageWithCacheInfo(
		topicId,
		lang,
		translationMode,
		itemsPerSource
	);
	return page;
}

export async function getTrendSourceCard(
	topicId: string,
	sourceId: string,
	lang: TranslationLanguage = "en",
	translationMode: TranslationMode = "background",
	itemsPerSource = DEFAULT_TRENDS_ITEMS_PER_SOURCE
): Promise<SourceCardData> {
	const topic = getTopicPreset(topicId);
	if (!topic) {
		throw new TopicNotFoundError(topicId);
	}
	if (
		!topic.sections.some((section) =>
			section.sourceIds.includes(sourceId as SourceId)
		)
	) {
		throw new TopicNotFoundError(`${topicId}/${sourceId}`);
	}

	let snapshot: SourceSnapshot | null;
	try {
		snapshot = await readSnapshot(sourceId as SourceId);
	} catch (error) {
		console.warn("[trends-page] failed to read source snapshot", error);
		throw new TrendsSnapshotsUnavailableError(error);
	}

	const source = snapshotToCard(sourceId as SourceId, snapshot, itemsPerSource);
	const translated = await translateTrendsPage(
		{
			id: topicId as TopicId,
			title: topic.title,
			description: topic.description,
			updatedAt: Date.now(),
			sections: [{ id: "source", title: source.title, sources: [source] }],
		},
		lang,
		translationMode
	);
	return translated.sections[0]?.sources[0] ?? source;
}
