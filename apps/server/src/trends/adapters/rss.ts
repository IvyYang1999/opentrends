import Parser from "rss-parser";

import type {
	FetchContext,
	NewsItem,
	RssSourcePreset,
	SourceAdapter,
} from "../types";
import {
	clampItems,
	cleanDescription,
	extractImageFromHtml,
	fetchText,
	isValidUrl,
	normalizeText,
	sortByPublishedAtDesc,
} from "./shared";

interface MediaAttrs {
	$?: { url?: string };
}

interface CustomItem {
	"content:encoded"?: string;
	id?: string;
	"media:content"?: MediaAttrs;
	"media:thumbnail"?: MediaAttrs;
}

const parser = new Parser<Record<string, unknown>, CustomItem>({
	customFields: {
		item: [
			["media:thumbnail", "media:thumbnail"],
			["media:content", "media:content"],
		],
	},
});

type RssItem = Parser.Item & CustomItem;

function pickEnclosureImage(item: RssItem): string | undefined {
	const enc = item.enclosure;
	if (!enc) {
		return;
	}
	// Some feeds omit the type attribute; treat that as a possible image
	// candidate and validate the URL below.
	const looksLikeImage = !enc.type || enc.type.startsWith("image/");
	if (looksLikeImage && isValidUrl(enc.url)) {
		return enc.url;
	}
	return;
}

function pickMediaImage(item: RssItem): string | undefined {
	const candidates = [
		item["media:thumbnail"]?.$?.url,
		item["media:content"]?.$?.url,
	];
	for (const candidate of candidates) {
		if (isValidUrl(candidate)) {
			return candidate;
		}
	}
	return;
}

function pickImage(item: RssItem): string | undefined {
	return (
		pickEnclosureImage(item) ??
		pickMediaImage(item) ??
		extractImageFromHtml(item["content:encoded"] ?? item.content)
	);
}

function pickDescription(item: RssItem): string | undefined {
	// Prefer rss-parser's pre-stripped contentSnippet (which for RSS comes
	// from <description>, not <content:encoded>), then fall back to Atom
	// summary or full content. cleanDescription clamps to a sane length.
	return (
		cleanDescription(item.contentSnippet) ??
		cleanDescription(item.summary) ??
		cleanDescription(item.content)
	);
}

// Google News titles end in " - Publisher". The publisher is already the
// source's name, so it goes; what is left may be empty when Google indexed
// a site page rather than an article.
const GOOGLE_NEWS_HOST = "news.google.com";
const PUBLISHER_SUFFIX_RE = /(?:^|\s+)-\s+[^-]{1,60}$/;

export function cleanGoogleNewsTitle(title: string): string {
	return normalizeText(title.replace(PUBLISHER_SUFFIX_RE, ""));
}

function isGoogleNewsFeed(feedUrl: string): boolean {
	try {
		return new URL(feedUrl).hostname === GOOGLE_NEWS_HOST;
	} catch {
		return false;
	}
}

function itemTitle(raw: RssItem, googleNews: boolean): string {
	const title = normalizeText(raw.title);
	return googleNews && title ? cleanGoogleNewsTitle(title) : title;
}

export function createRssAdapter(preset: RssSourcePreset): SourceAdapter {
	const googleNews = isGoogleNewsFeed(preset.feedUrl);
	return {
		async fetch(ctx: FetchContext): Promise<NewsItem[]> {
			const xml = await fetchText(preset.feedUrl, { signal: ctx.signal });
			const feed = await parser.parseString(xml);
			const fetchedAt = Date.now();
			const items: NewsItem[] = [];

			// A search feed can return the same page under several links; one
			// title per feed is enough.
			const seenTitles = new Set<string>();
			let rank = 0;
			for (const raw of feed.items) {
				rank += 1;
				const title = itemTitle(raw, googleNews);
				const link = raw.link;
				if (!(title && isValidUrl(link)) || seenTitles.has(title)) {
					continue;
				}
				seenTitles.add(title);
				const dateStr = raw.isoDate ?? raw.pubDate;
				const published = dateStr ? Date.parse(dateStr) : Number.NaN;
				const guid = normalizeText(raw.guid) || normalizeText(raw.id);
				items.push({
					id: guid || link,
					sourceId: ctx.sourceId,
					title,
					url: link,
					rank,
					publishedAt: Number.isFinite(published) ? published : undefined,
					fetchedAt,
					description: pickDescription(raw),
					imageUrl: pickImage(raw),
				});
			}

			return clampItems(sortByPublishedAtDesc(items));
		},
	};
}
