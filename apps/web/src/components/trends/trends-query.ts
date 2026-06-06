import { queryOptions } from "@tanstack/react-query";

import type { Locale } from "@/lib/i18n";

import {
	loadTrendEventDetail,
	loadTrendEvents,
	loadTrendSource,
	loadTrends,
	TRENDS_FULL_ITEMS_PER_SOURCE,
	TRENDS_PREVIEW_ITEMS_PER_SOURCE,
} from "./load-trends";
import type {
	EventDetailData,
	EventFeedData,
	SourceCardData,
	TrendsPageData,
} from "./types";

export const TRENDS_PAGE_GC_MS = 30 * 60_000;
export const TRENDS_PAGE_STALE_MS = 10 * 60_000;

export function trendsPageQueryOptions(topic: string, locale: Locale) {
	return queryOptions<TrendsPageData, Error>({
		queryKey: ["trends-page", topic, locale, TRENDS_PREVIEW_ITEMS_PER_SOURCE],
		queryFn: () =>
			loadTrends(topic, locale, "background", TRENDS_PREVIEW_ITEMS_PER_SOURCE),
		gcTime: TRENDS_PAGE_GC_MS,
		refetchOnWindowFocus: false,
		staleTime: TRENDS_PAGE_STALE_MS,
	});
}

export function trendSourceQueryOptions(
	topic: string,
	sourceId: string,
	locale: Locale
) {
	return queryOptions<SourceCardData, Error>({
		queryKey: [
			"trend-source",
			topic,
			sourceId,
			locale,
			"sync",
			TRENDS_FULL_ITEMS_PER_SOURCE,
		],
		queryFn: () =>
			loadTrendSource(
				topic,
				sourceId,
				locale,
				"sync",
				TRENDS_FULL_ITEMS_PER_SOURCE
			),
		gcTime: TRENDS_PAGE_GC_MS,
		refetchOnWindowFocus: false,
		staleTime: TRENDS_PAGE_STALE_MS,
	});
}

export function trendEventsQueryOptions(topic?: string, locale: Locale = "en") {
	return queryOptions<EventFeedData, Error>({
		queryKey: ["trend-events", topic ?? "all", locale],
		queryFn: () => loadTrendEvents(topic, 0, 30, locale),
		gcTime: TRENDS_PAGE_GC_MS,
		refetchOnWindowFocus: false,
		staleTime: TRENDS_PAGE_STALE_MS,
	});
}

export function trendEventDetailQueryOptions(
	eventId: string,
	topic?: string,
	locale: Locale = "en"
) {
	return queryOptions<EventDetailData, Error>({
		queryKey: ["trend-event-detail", eventId, topic ?? "all", locale],
		queryFn: () => loadTrendEventDetail(eventId, topic, locale),
		gcTime: TRENDS_PAGE_GC_MS,
		refetchOnWindowFocus: false,
		staleTime: TRENDS_PAGE_STALE_MS,
	});
}
