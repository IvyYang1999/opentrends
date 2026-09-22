import type { NewsItem, SourceCardData, TrendsPageData } from "./types";

export interface FeedEntry {
	heat?: number;
	item: NewsItem;
	kind: "item";
	score: number;
	source: SourceCardData;
}

// A whole ranking shown as one card inside the feed, every so often, so the
// stream is not only single stories.
export interface FeedListEntry {
	kind: "list";
	source: SourceCardData;
}

export type FeedBlock = FeedEntry | FeedListEntry;

const HOUR_MS = 60 * 60 * 1000;
// How quickly freshness fades: an item loses half its recency score every
// 18 hours, so yesterday's story still surfaces, last week's does not.
const RECENCY_HALF_LIFE_MS = 18 * HOUR_MS;
const FOLLOWED_BOOST = 1.6;
const HEAT_WEIGHT = 0.35;
const COVER_BOOST = 1.25;
// Per ten slots, how many go to illustrated items when enough exist.
const COVER_QUOTA = 7;
const SLOTS_PER_ROUND = 10;
// A source may appear at most this many times within a window of recent
// slots, so one busy feed cannot own a screen.
const SOURCE_WINDOW = 12;
const SOURCE_WINDOW_LIMIT = 2;
// A ranking card is slipped in after this many story cards.
// Seven is coprime with every column count in use (2–6), so the cards land
// in different columns instead of stacking down one.
const LIST_EVERY = 7;
// Text posters alternate between short and long titles so a column does not
// become a stack of identical-looking blocks.
const SHORT_TITLE_CHARS = 22;

function titleLengthClass(entry: FeedEntry): "short" | "long" {
	return entry.item.title.length <= SHORT_TITLE_CHARS ? "short" : "long";
}
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
			(followed ? FOLLOWED_BOOST : 1) *
			(item.imageUrl ? COVER_BOOST : 1);
		return { heat, item, kind: "item" as const, score, source };
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
	return arrangeFeed(entries);
}

// Fills the feed slot by slot: each round of ten hands most slots to
// illustrated items, and no source may crowd a window of recent slots.
// Falls back gracefully when a pool runs dry.
export function arrangeFeed(sorted: FeedEntry[]): FeedEntry[] {
	const withCover = sorted.filter((entry) => Boolean(entry.item.imageUrl));
	const textOnly = sorted.filter((entry) => !entry.item.imageUrl);
	const result: FeedEntry[] = [];
	const recent: string[] = [];
	let lastTextClass: "short" | "long" | undefined;

	const take = (pool: FeedEntry[]): FeedEntry | undefined => {
		const counts = new Map<string, number>();
		for (const id of recent) {
			counts.set(id, (counts.get(id) ?? 0) + 1);
		}
		const roomFor = (entry: FeedEntry) =>
			(counts.get(entry.source.sourceId) ?? 0) < SOURCE_WINDOW_LIMIT;
		const preferred = pool.findIndex(
			(entry) =>
				roomFor(entry) &&
				(pool !== textOnly || titleLengthClass(entry) !== lastTextClass)
		);
		const index = preferred === -1 ? pool.findIndex(roomFor) : preferred;
		const [entry] = pool.splice(index === -1 ? 0 : index, 1);
		if (entry && pool === textOnly) {
			lastTextClass = titleLengthClass(entry);
		}
		return entry;
	};

	while (withCover.length + textOnly.length > 0) {
		const slot = result.length % SLOTS_PER_ROUND;
		const wantCover = slot < COVER_QUOTA;
		const primary = wantCover ? withCover : textOnly;
		const fallback = wantCover ? textOnly : withCover;
		const entry = take(primary.length > 0 ? primary : fallback);
		if (!entry) {
			break;
		}
		result.push(entry);
		recent.push(entry.source.sourceId);
		if (recent.length > SOURCE_WINDOW) {
			recent.shift();
		}
	}
	return result;
}

// Weaves ranking cards into the story stream.
export function withListCards(
	entries: FeedEntry[],
	rankings: readonly SourceCardData[]
): FeedBlock[] {
	if (rankings.length === 0) {
		return entries;
	}
	const blocks: FeedBlock[] = [];
	let next = 0;
	for (const [index, entry] of entries.entries()) {
		blocks.push(entry);
		if ((index + 1) % LIST_EVERY === 0 && next < rankings.length) {
			blocks.push({ kind: "list", source: rankings[next] as SourceCardData });
			next += 1;
		}
	}
	return blocks;
}
