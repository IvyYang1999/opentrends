import type { FeedSignal } from "./feed-signals";
import type { NewsItem } from "./types";

// What the feed knows about the person reading it, all derived on their own
// device: the language they read in, roughly where they are (from the
// timezone), the hour, and which sources and subjects they have been
// clicking. Nothing here is sent anywhere.
export interface ReaderContext {
	/** Local hour, 0–23. */
	hour: number;
	/** The reader's language: "zh" for Chinese, otherwise a Latin-script one. */
	locale: string;
	/** True when the timezone places the reader in the Chinese-speaking world. */
	sinosphere: boolean;
	/** Source id → recent click weight, 0..1. */
	sourceAffinity: ReadonlyMap<string, number>;
	/** Title token → recent click weight, 0..1. */
	termAffinity: ReadonlyMap<string, number>;
}

export const NEUTRAL_READER: ReaderContext = {
	hour: 12,
	locale: "en",
	sinosphere: false,
	sourceAffinity: new Map(),
	termAffinity: new Map(),
};

const DAY_MS = 24 * 60 * 60 * 1000;
// A click from a week ago counts half as much as one from today.
const SIGNAL_HALF_LIFE_MS = 7 * DAY_MS;
// Clicks needed on one source, or shared subjects, before the boost is full.
const SOURCE_SATURATION = 5;
const TERM_SATURATION = 3;
const SINOSPHERE_ZONES = new Set([
	"Asia/Shanghai",
	"Asia/Chongqing",
	"Asia/Harbin",
	"Asia/Urumqi",
	"Asia/Hong_Kong",
	"Asia/Macau",
	"Asia/Taipei",
	"PRC",
]);
const CJK_RE = /[㐀-鿿]/;
const CJK_RUN_RE = /[㐀-鿿]{2,}/g;
const LATIN_WORD_RE = /[a-z][a-z0-9+#.-]{2,}/g;
const STOP_WORDS = new Set([
	"the",
	"and",
	"for",
	"with",
	"that",
	"this",
	"from",
	"you",
	"your",
	"are",
	"how",
	"why",
	"what",
	"new",
	"into",
	"about",
	"after",
	"over",
	"than",
	"has",
	"have",
	"its",
	"not",
	"can",
	"will",
	"just",
	"more",
	"one",
	"out",
]);

// Subjects a title is about: Latin words of three letters or more, and
// overlapping pairs of Chinese characters (words are not delimited, so
// bigrams stand in for them).
export function titleTerms(title: string): string[] {
	const terms = new Set<string>();
	for (const word of title.toLowerCase().match(LATIN_WORD_RE) ?? []) {
		if (!STOP_WORDS.has(word)) {
			terms.add(word);
		}
	}
	for (const run of title.match(CJK_RUN_RE) ?? []) {
		for (let i = 0; i + 1 < run.length; i += 1) {
			terms.add(run.slice(i, i + 2));
		}
	}
	return [...terms];
}

export function isChineseText(text: string): boolean {
	return CJK_RE.test(text);
}

// The language an item was written in, before translation.
export function itemIsChinese(item: NewsItem): boolean {
	return isChineseText(item.original?.title ?? item.title);
}

function decayed(at: number, now: number): number {
	return 2 ** (-Math.max(0, now - at) / SIGNAL_HALF_LIFE_MS);
}

function saturate(weight: number, saturation: number): number {
	return Math.min(1, weight / saturation);
}

export function affinitiesFromSignals(
	signals: readonly FeedSignal[],
	now: number
): Pick<ReaderContext, "sourceAffinity" | "termAffinity"> {
	const sources = new Map<string, number>();
	const terms = new Map<string, number>();
	for (const signal of signals) {
		const weight = decayed(signal.at, now);
		sources.set(signal.sourceId, (sources.get(signal.sourceId) ?? 0) + weight);
		for (const term of titleTerms(signal.title)) {
			terms.set(term, (terms.get(term) ?? 0) + weight);
		}
	}
	for (const [id, weight] of sources) {
		sources.set(id, saturate(weight, SOURCE_SATURATION));
	}
	for (const [term, weight] of terms) {
		terms.set(term, saturate(weight, TERM_SATURATION));
	}
	return { sourceAffinity: sources, termAffinity: terms };
}

export function isSinosphereZone(timeZone: string | undefined): boolean {
	return timeZone !== undefined && SINOSPHERE_ZONES.has(timeZone);
}

export function buildReaderContext(options: {
	locale: string;
	now: number;
	signals: readonly FeedSignal[];
	timeZone?: string;
}): ReaderContext {
	return {
		hour: new Date(options.now).getHours(),
		locale: options.locale,
		sinosphere: isSinosphereZone(options.timeZone),
		...affinitiesFromSignals(options.signals, options.now),
	};
}

// How much one item's subjects overlap what the reader has clicked, 0..1.
export function termOverlap(
	title: string,
	termAffinity: ReadonlyMap<string, number>
): number {
	if (termAffinity.size === 0) {
		return 0;
	}
	let sum = 0;
	for (const term of titleTerms(title)) {
		sum += termAffinity.get(term) ?? 0;
	}
	return Math.min(1, sum);
}
