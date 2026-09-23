import { type CacheEnvelope, hotCache } from "../cache/hot-cache";
import { readSourceItemHistory } from "../cache/source-cache";
import { getSourcePreset } from "../config/sources";
import { getTopicPreset } from "../config/topics";
import type { NewsItem, SourceId, TopicPreset } from "../types";
import { archiveDayFor, readArchivedDigest } from "./digest-archive";
import { type DigestJsonEntry, parseDigestEntries } from "./digest-json";
import { TopicNotFoundError } from "./get-trends-page";
import {
	type TranslationLanguage,
	translateNewsItems,
} from "./translate-news-items";

// A month of a topic, one day at a time: the items that led their sources
// on each day, so a reader can look back at what happened, not only at what
// is hot now. Built from the item history table, titles from the
// translation cache when they are there, and kept for an hour per month.

export interface CalendarItem {
	publishedAt: number;
	rank: number;
	sourceId: string;
	sourceTitle: string;
	title: string;
	url: string;
}

export interface CalendarMonth {
	days: Record<string, CalendarItem[]>;
	/** The day's final ten-line digest, where one was kept. */
	digests: Record<string, DigestJsonEntry[]>;
	lang: TranslationLanguage;
	month: string;
	topic: string;
	tzOffsetMinutes: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ITEMS_PER_SOURCE_PER_DAY = 3;
const ITEMS_PER_DAY = 12;
const CALENDAR_TTL_SECONDS = 60 * 60;
const CALENDAR_SCHEMA_VERSION = 2;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function parseMonth(value: string | undefined): {
	month: string;
	year: number;
	monthIndex: number;
} | null {
	const match = MONTH_RE.exec(value ?? "");
	if (!(match?.[1] && match[2])) {
		return null;
	}
	return {
		month: `${match[1]}-${match[2]}`,
		monthIndex: Number.parseInt(match[2], 10) - 1,
		year: Number.parseInt(match[1], 10),
	};
}

export function parseTzOffset(value: string | undefined): number {
	const parsed = Number.parseInt(value ?? "", 10);
	if (!Number.isFinite(parsed) || parsed < -14 * 60 || parsed > 14 * 60) {
		return 0;
	}
	return parsed;
}

// The calendar day an instant falls on for a reader at this UTC offset.
export function dayKey(timestamp: number, tzOffsetMinutes: number): string {
	return new Date(timestamp + tzOffsetMinutes * 60_000)
		.toISOString()
		.slice(0, 10);
}

function monthRange(
	year: number,
	monthIndex: number,
	tzOffsetMinutes: number
): { end: number; start: number } {
	const start = Date.UTC(year, monthIndex, 1) - tzOffsetMinutes * 60_000;
	const end = Date.UTC(year, monthIndex + 1, 1) - tzOffsetMinutes * 60_000;
	return { end, start };
}

function topicSourceIds(topic: TopicPreset): SourceId[] {
	return [
		...new Set(topic.sections.flatMap((section) => section.sourceIds)),
	] as SourceId[];
}

// Each day keeps the items that ranked highest on their source, taken
// round-robin across sources so one busy feed cannot fill a day.
export function pickDay(items: readonly NewsItem[]): NewsItem[] {
	const bySource = new Map<string, NewsItem[]>();
	for (const item of items) {
		const list = bySource.get(item.sourceId) ?? [];
		list.push(item);
		bySource.set(item.sourceId, list);
	}
	for (const list of bySource.values()) {
		list.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
	}
	const picked: NewsItem[] = [];
	const seen = new Set<string>();
	let round = 0;
	while (picked.length < ITEMS_PER_DAY) {
		let took = false;
		for (const list of bySource.values()) {
			const item = list[round];
			if (item && !seen.has(item.url)) {
				seen.add(item.url);
				picked.push(item);
				took = true;
				if (picked.length >= ITEMS_PER_DAY) {
					break;
				}
			}
		}
		if (!took) {
			break;
		}
		round += 1;
	}
	return picked;
}

function cacheKey(
	topicId: string,
	month: string,
	lang: TranslationLanguage,
	tzOffsetMinutes: number
): string {
	return `trends:v1:calendar:${topicId}:${month}:${lang}:${tzOffsetMinutes}`;
}

export async function getCalendarMonth(
	topicId: string,
	month: string,
	lang: TranslationLanguage,
	tzOffsetMinutes: number
): Promise<CalendarMonth> {
	const parsed = parseMonth(month);
	const topic = getTopicPreset(topicId);
	if (!(parsed && topic)) {
		throw new TopicNotFoundError(topicId);
	}
	const key = cacheKey(topicId, parsed.month, lang, tzOffsetMinutes);
	const cached = await hotCache.get<CalendarMonth>(key).catch(() => null);
	if (
		cached &&
		cached.schemaVersion === CALENDAR_SCHEMA_VERSION &&
		cached.freshUntil > Date.now()
	) {
		return cached.value;
	}

	const { end, start } = monthRange(
		parsed.year,
		parsed.monthIndex,
		tzOffsetMinutes
	);
	const history = await readSourceItemHistory(
		topicSourceIds(topic),
		start,
		ITEMS_PER_SOURCE_PER_DAY
	);
	const byDay = new Map<string, NewsItem[]>();
	for (const items of history.values()) {
		for (const item of items) {
			const at = item.publishedAt ?? item.fetchedAt;
			if (at < start || at >= end) {
				continue;
			}
			const day = dayKey(at, tzOffsetMinutes);
			const list = byDay.get(day) ?? [];
			list.push(item);
			byDay.set(day, list);
		}
	}
	const pickedByDay = new Map<string, NewsItem[]>();
	for (const [day, items] of byDay) {
		pickedByDay.set(day, pickDay(items));
	}
	const translated = await translateNewsItems(
		[...pickedByDay.values()].flat(),
		lang,
		"background"
	);
	const titleByUrl = new Map(translated.map((item) => [item.url, item.title]));
	const days: Record<string, CalendarItem[]> = {};
	for (const [day, items] of [...pickedByDay].sort(([a], [b]) =>
		a.localeCompare(b)
	)) {
		days[day] = items.map((item) => ({
			publishedAt: item.publishedAt ?? item.fetchedAt,
			rank: item.rank ?? 99,
			sourceId: item.sourceId,
			sourceTitle: getSourcePreset(item.sourceId)?.name ?? item.sourceId,
			title: titleByUrl.get(item.url) ?? item.title,
			url: item.url,
		}));
	}
	const digests = await readMonthDigests(
		topicId,
		lang,
		parsed.year,
		parsed.monthIndex,
		tzOffsetMinutes
	);
	const value: CalendarMonth = {
		days,
		digests,
		lang,
		month: parsed.month,
		topic: topicId,
		tzOffsetMinutes,
	};
	const now = Date.now();
	const envelope: CacheEnvelope<CalendarMonth> = {
		createdAt: now,
		freshUntil: now + CALENDAR_TTL_SECONDS * 1000,
		schemaVersion: CALENDAR_SCHEMA_VERSION,
		staleUntil: now + CALENDAR_TTL_SECONDS * 1000,
		value,
	};
	await hotCache.put(key, envelope, CALENDAR_TTL_SECONDS).catch(() => false);
	return value;
}

// One read per day of the month, in parallel; most come back empty until
// the archive has been running for a while.
async function readMonthDigests(
	topicId: string,
	lang: TranslationLanguage,
	year: number,
	monthIndex: number,
	tzOffsetMinutes: number
): Promise<Record<string, DigestJsonEntry[]>> {
	const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
	const month = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
	const today = dayKey(Date.now(), tzOffsetMinutes);
	const localDays = Array.from(
		{ length: daysInMonth },
		(_, index) => `${month}-${String(index + 1).padStart(2, "0")}`
	).filter((day) => day <= today);
	const results = await Promise.all(
		localDays.map(async (day) => {
			const archived = await readArchivedDigest(
				topicId,
				lang,
				archiveDayFor(day, tzOffsetMinutes)
			);
			return [day, archived] as const;
		})
	);
	const digests: Record<string, DigestJsonEntry[]> = {};
	for (const [day, archived] of results) {
		if (archived) {
			digests[day] = parseDigestEntries(archived.text, archived.citations);
		}
	}
	return digests;
}

export const CALENDAR_DAY_MS = DAY_MS;
