import type { NewsItem, SourceCardData, TrendsPageData } from "./types";

export interface FeedEntry {
	heat?: number;
	item: NewsItem;
	score: number;
	source: SourceCardData;
}

const HOUR_MS = 60 * 60 * 1000;
// How quickly freshness fades: an item loses half its recency score every
// 18 hours, so yesterday's story still surfaces, last week's does not.
const RECENCY_HALF_LIFE_MS = 18 * HOUR_MS;
const FOLLOWED_BOOST = 1.6;
const HEAT_WEIGHT = 0.35;
// Items without a publish date only have the fetch time, which would put a
// whole feed at the top every refresh; they are treated as a day old.
const UNDATED_AGE_MS = 24 * HOUR_MS;
// "248.1万热度", "1.2k", "36,096"
const HEAT_RE = /([\d,.]+)\s*([kKmM万亿]?)/;
const HEAT_UNITS: Record<string, number> = {
	k: 1e3,
	K: 1e3,
	m: 1e6,
	M: 1e6,
	万: 1e4,
	亿: 1e8,
};

function parseHeat(value: NewsItem["hotValue"]): number | undefined {
	if (typeof value === "number") {
		return value;
	}
	if (typeof value !== "string") {
		return;
	}
	const match = HEAT_RE.exec(value);
	if (!match?.[1]) {
		return;
	}
	const base = Number.parseFloat(match[1].replaceAll(",", ""));
	if (!Number.isFinite(base)) {
		return;
	}
	return base * (HEAT_UNITS[match[2] ?? ""] ?? 1);
}

// Heat scales wildly between platforms (HN points vs Weibo views), so it is
// normalised within each source before it can influence the order.
function heatFactor(heat: number | undefined, max: number): number {
	if (heat === undefined || max <= 0) {
		return 0;
	}
	return Math.log1p(heat) / Math.log1p(max);
}

function scoreSource(
	source: SourceCardData,
	followed: boolean,
	now: number
): FeedEntry[] {
	const heats = source.items.map((item) => parseHeat(item.hotValue));
	const maxHeat = Math.max(
		0,
		...heats.filter((h): h is number => h !== undefined)
	);
	return source.items.map((item, index) => {
		const age = item.publishedAt
			? Math.max(0, now - item.publishedAt)
			: UNDATED_AGE_MS;
		const recency = 2 ** (-age / RECENCY_HALF_LIFE_MS);
		const heat = heats[index];
		const score =
			recency *
			(1 + HEAT_WEIGHT * heatFactor(heat, maxHeat)) *
			(followed ? FOLLOWED_BOOST : 1);
		return { heat, item, score, source };
	});
}

export function rankFeed(
	pages: readonly TrendsPageData[],
	followedIds: readonly string[],
	now: number = Date.now()
): FeedEntry[] {
	const followed = new Set(followedIds);
	const seen = new Set<string>();
	const entries = pages
		.flatMap((page) => page.sections)
		.flatMap((section) => section.sources)
		.flatMap((source) =>
			scoreSource(source, followed.has(source.sourceId), now)
		)
		.filter((entry) => {
			if (seen.has(entry.item.url)) {
				return false;
			}
			seen.add(entry.item.url);
			return true;
		});
	entries.sort((a, b) => b.score - a.score);
	return interleaveSources(entries);
}

// A feed that shows five Hacker News posts in a row reads like a source
// page again. Adjacent entries from one source are pushed apart.
export function interleaveSources(entries: FeedEntry[]): FeedEntry[] {
	const result: FeedEntry[] = [];
	const pending = [...entries];
	while (pending.length > 0) {
		const last = result.at(-1)?.source.sourceId;
		const index = pending.findIndex((entry) => entry.source.sourceId !== last);
		const [next] = pending.splice(index === -1 ? 0 : index, 1);
		if (next) {
			result.push(next);
		}
	}
	return result;
}
