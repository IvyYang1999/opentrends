import Parser from "rss-parser";

import type { FetchContext, NewsItem, SourceAdapter } from "../../types";
import {
	clampItems,
	cleanDescription,
	extractImageFromHtml,
	fetchText,
	isValidUrl,
	normalizeText,
} from "../shared";

const FEED_URL = "https://www.producthunt.com/feed?category=undefined";

const parser = new Parser();

export const productHuntAdapter: SourceAdapter = {
	async fetch(ctx: FetchContext): Promise<NewsItem[]> {
		const xml = await fetchText(FEED_URL, { signal: ctx.signal });
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
			const guid = normalizeText(raw.guid);
			items.push({
				id: guid || `ph-${link}`,
				sourceId: ctx.sourceId,
				title,
				url: link,
				rank,
				publishedAt: Number.isFinite(published) ? published : undefined,
				fetchedAt,
				description:
					cleanDescription(raw.contentSnippet) ?? cleanDescription(raw.content),
				imageUrl: extractImageFromHtml(raw.content),
			});
		}

		return clampItems(items);
	},
};
