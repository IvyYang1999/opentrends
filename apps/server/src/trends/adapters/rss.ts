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

export function createRssAdapter(preset: RssSourcePreset): SourceAdapter {
	return {
		async fetch(ctx: FetchContext): Promise<NewsItem[]> {
			const xml = await fetchText(preset.feedUrl, { signal: ctx.signal });
			const feed = await parser.parseString(xml);
			const fetchedAt = Date.now();
			const items: NewsItem[] = [];

			let rank = 0;
			for (const raw of feed.items) {
				rank += 1;
				const title = normalizeText(raw.title);
				const link = raw.link;
				if (!(title && isValidUrl(link))) {
					continue;
				}
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
