import { type ItemAttribute, itemAttributes } from "./item-attributes";
import {
	itemIsChinese,
	NEUTRAL_READER,
	type ReaderContext,
	termOverlap,
} from "./reader-context";
import { coverKind } from "./source-card-model";
import type { NewsItem, SourceCardData, TrendsPageData } from "./types";

export interface FeedEntry {
	attributes: ItemAttribute[];
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
const COVER_BOOST = 1.1;
// Reader fit. Translation loses something, so an item written in the
// reader's own language gets a small edge; the region hint adds a little
// more for Chinese-language items when the reader is in that part of the
// world. Behaviour weighs more than either: a source the reader keeps
// opening can gain up to 40%, a subject they keep opening up to 25%.
const OWN_LANGUAGE_BOOST = 1.12;
const REGION_BOOST = 1.08;
const SOURCE_AFFINITY_WEIGHT = 0.4;
const TERM_AFFINITY_WEIGHT = 0.25;
// Taste for kinds of card: a reader who clicks pictures twice as often as
// the feed shows them gets more pictures, and so on for fresh vs hot,
// community vs official, Chinese vs not. Measured against the current pool,
// so it corrects for what was on offer, and capped so it never drowns
// freshness.
const ATTRIBUTE_WEIGHT = 0.3;
const ATTRIBUTE_BOOST_MAX = 1.3;
const ATTRIBUTE_BOOST_MIN = 0.85;
// Heat above this share of the source's top is "hot".
const HOT_THRESHOLD = 0.5;
// In the morning the feed should catch up on the night: freshness fades more
// slowly and heat counts for more, since what the world reacted to overnight
// is the news.
const MORNING_HOURS = { from: 5, to: 10 } as const;
const MORNING_HALF_LIFE_MS = 26 * HOUR_MS;
const MORNING_HEAT_WEIGHT = 0.5;
// Per ten slots, how many go to illustrated items when enough exist. Text
// posters read better than most covers, so they get the larger share.
const COVER_QUOTA = 4;
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

function isMorning(hour: number): boolean {
	return hour >= MORNING_HOURS.from && hour < MORNING_HOURS.to;
}

function readerFit(item: NewsItem, reader: ReaderContext): number {
	const chinese = itemIsChinese(item);
	const ownLanguage = reader.locale === "zh" ? chinese : !chinese;
	return (
		(ownLanguage ? OWN_LANGUAGE_BOOST : 1) *
		(reader.sinosphere && chinese ? REGION_BOOST : 1) *
		(1 + TERM_AFFINITY_WEIGHT * termOverlap(item.title, reader.termAffinity))
	);
}

function scoreSource(
	source: SourceCardData,
	followed: boolean,
	reader: ReaderContext,
	now: number
): FeedEntry[] {
	const heats = source.items.map((item) => parseHeat(item.hotValue));
	const maxHeat = Math.max(
		0,
		...heats.filter((h): h is number => h !== undefined)
	);
	const morning = isMorning(reader.hour);
	const halfLife = morning ? MORNING_HALF_LIFE_MS : RECENCY_HALF_LIFE_MS;
	const heatWeight = morning ? MORNING_HEAT_WEIGHT : HEAT_WEIGHT;
	const sourceBoost =
		1 +
		SOURCE_AFFINITY_WEIGHT * (reader.sourceAffinity.get(source.sourceId) ?? 0);
	return source.items.map((item, index) => {
		const age = item.publishedAt
			? Math.max(0, now - item.publishedAt)
			: UNDATED_AGE_MS;
		const recency = 2 ** (-age / halfLife);
		const heat = heats[index];
		const hotness = heatFactor(heat, maxHeat);
		const score =
			recency *
			(1 + heatWeight * hotness) *
			(followed ? FOLLOWED_BOOST : 1) *
			(coverKind(item.imageUrl) === "cover" ? COVER_BOOST : 1) *
			sourceBoost *
			readerFit(item, reader);
		return {
			attributes: itemAttributes(item, source, {
				hot: hotness >= HOT_THRESHOLD,
				now,
			}),
			heat,
			item,
			kind: "item" as const,
			score,
			source,
		};
	});
}

// Scales each entry by how much more (or less) the reader clicks its kind of
// card than the pool offers it.
function applyAttributeTaste(entries: FeedEntry[], reader: ReaderContext) {
	if (reader.attributeShare.size === 0 || entries.length === 0) {
		return;
	}
	const poolShare = new Map<string, number>();
	for (const entry of entries) {
		for (const attribute of entry.attributes) {
			poolShare.set(attribute, (poolShare.get(attribute) ?? 0) + 1);
		}
	}
	const factor = new Map<string, number>();
	for (const [attribute, count] of poolShare) {
		const offered = Math.max(count / entries.length, 0.05);
		const clicked = reader.attributeShare.get(attribute) ?? 0;
		const raw = 1 + (ATTRIBUTE_WEIGHT * (clicked - offered)) / offered;
		factor.set(
			attribute,
			Math.min(ATTRIBUTE_BOOST_MAX, Math.max(ATTRIBUTE_BOOST_MIN, raw))
		);
	}
	for (const entry of entries) {
		for (const attribute of entry.attributes) {
			entry.score *= factor.get(attribute) ?? 1;
		}
	}
}

export function rankFeed(
	pages: readonly TrendsPageData[],
	followedIds: readonly string[],
	now: number = Date.now(),
	reader: ReaderContext = NEUTRAL_READER
): FeedEntry[] {
	const followed = new Set(followedIds);
	const seen = new Set<string>();
	const entries = pages
		.flatMap((page) => page.sections)
		.flatMap((section) => section.sources)
		.flatMap((source) =>
			scoreSource(source, followed.has(source.sourceId), reader, now)
		)
		.filter((entry) => {
			if (seen.has(entry.item.url)) {
				return false;
			}
			seen.add(entry.item.url);
			return true;
		});
	applyAttributeTaste(entries, reader);
	entries.sort((a, b) => b.score - a.score);
	return arrangeFeed(entries);
}

// Fills the feed slot by slot: each round of ten hands most slots to
// illustrated items, and no source may crowd a window of recent slots.
// Falls back gracefully when a pool runs dry.
export function arrangeFeed(sorted: FeedEntry[]): FeedEntry[] {
	const withCover = sorted.filter(
		(entry) => coverKind(entry.item.imageUrl) === "cover"
	);
	const textOnly = sorted.filter(
		(entry) => coverKind(entry.item.imageUrl) !== "cover"
	);
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
