import type { NewsItem, SourceCardData } from "./types";

// Reading behaviour, kept in the browser for now. It is the raw material for
// ranking the feed by taste later; nothing leaves the device until that
// exists and the reader has been told.
const STORAGE_KEY = "opentrends:feed:signals:v1";
const MAX_SIGNALS = 500;

export interface FeedSignal {
	at: number;
	/** What kind of card was clicked, see item-attributes.ts. */
	attributes?: string[];
	kind: "click";
	sourceId: string;
	title: string;
	url: string;
}

export function readFeedSignals(): FeedSignal[] {
	if (typeof window === "undefined") {
		return [];
	}
	try {
		const parsed: unknown = JSON.parse(
			window.localStorage.getItem(STORAGE_KEY) ?? "[]"
		);
		return Array.isArray(parsed) ? (parsed as FeedSignal[]) : [];
	} catch {
		return [];
	}
}

export function recordFeedClick(
	item: NewsItem,
	source: SourceCardData,
	attributes?: readonly string[]
): void {
	if (typeof window === "undefined") {
		return;
	}
	try {
		const signals = readFeedSignals();
		signals.push({
			at: Date.now(),
			attributes: attributes ? [...attributes] : undefined,
			kind: "click",
			sourceId: source.sourceId,
			title: item.original?.title ?? item.title,
			url: item.url,
		});
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify(signals.slice(-MAX_SIGNALS))
		);
	} catch {
		/* Storage may be unavailable; the click still opens the article. */
	}
}
