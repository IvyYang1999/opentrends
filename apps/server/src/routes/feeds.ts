import { Hono } from "hono";

import { parseDigestEntries } from "../trends/services/digest-json";
import {
	getTrendsPage,
	TopicNotFoundError,
	TrendsSnapshotsUnavailableError,
} from "../trends/services/get-trends-page";
import {
	normalizeSummaryWindow,
	prepareTrendsSummary,
	TrendsSummaryNotConfiguredError,
	TrendsSummaryPendingError,
} from "../trends/services/get-trends-summary";
import { normalizeTranslationLanguage } from "../trends/services/translate-news-items";
import type { NewsItem, TrendsPageData } from "../trends/types";

// RSS 2.0 for readers and automations: a topic's latest items across its
// sources, and its digest as one entry per edition. Both are plain GETs
// with long cache headers; nothing here triggers model work.
const SITE_URL = "https://opentrends.io";
const ITEM_FEED_LIMIT = 50;
const ITEM_FEED_CACHE = "public, max-age=1800, s-maxage=1800";
const DIGEST_FEED_CACHE = "public, max-age=1800, s-maxage=1800";

const XML_ESCAPES: Record<string, string> = {
	"&": "&amp;",
	"'": "&apos;",
	'"': "&quot;",
	"<": "&lt;",
	">": "&gt;",
};
const XML_ESCAPE_RE = /[&'"<>]/g;

function escapeXml(value: string): string {
	return value.replace(XML_ESCAPE_RE, (char) => XML_ESCAPES[char] ?? char);
}

function rssDate(timestamp: number): string {
	return new Date(timestamp).toUTCString();
}

function rssDocument(
	channel: { description: string; link: string; title: string },
	items: string[]
): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${escapeXml(channel.title)}</title>
<link>${escapeXml(channel.link)}</link>
<description>${escapeXml(channel.description)}</description>
<language>zh</language>
<generator>OpenTrends</generator>
${items.join("\n")}
</channel>
</rss>
`;
}

interface FeedItem {
	item: NewsItem;
	sourceHome?: string;
	sourceTitle: string;
}

// Newest first; items without a publish date sort by when they were seen,
// after everything dated.
function latestItems(page: TrendsPageData): FeedItem[] {
	const seen = new Set<string>();
	const all: FeedItem[] = [];
	for (const section of page.sections) {
		for (const source of section.sources) {
			for (const item of source.items) {
				if (seen.has(item.url)) {
					continue;
				}
				seen.add(item.url);
				all.push({
					item,
					sourceHome: source.homeUrl,
					sourceTitle: source.title,
				});
			}
		}
	}
	all.sort((a, b) => {
		const aDated = a.item.publishedAt !== undefined;
		const bDated = b.item.publishedAt !== undefined;
		if (aDated !== bDated) {
			return aDated ? -1 : 1;
		}
		return (
			(b.item.publishedAt ?? b.item.fetchedAt) -
			(a.item.publishedAt ?? a.item.fetchedAt)
		);
	});
	return all.slice(0, ITEM_FEED_LIMIT);
}

function itemXml({ item, sourceHome, sourceTitle }: FeedItem): string {
	const description = item.description
		? `${sourceTitle} · ${item.description}`
		: sourceTitle;
	const source = sourceHome
		? `<source url="${escapeXml(sourceHome)}">${escapeXml(sourceTitle)}</source>`
		: "";
	return `<item>
<title>${escapeXml(item.title)}</title>
<link>${escapeXml(item.url)}</link>
<guid isPermaLink="true">${escapeXml(item.url)}</guid>
<description>${escapeXml(description)}</description>
<pubDate>${rssDate(item.publishedAt ?? item.fetchedAt)}</pubDate>
${source}
</item>`;
}

function digestHtml(entries: ReturnType<typeof parseDigestEntries>): string {
	const lines = entries.map((entry) => {
		const links = entry.citations
			.map(
				(citation) => `<a href="${escapeXml(citation.url)}">[${citation.n}]</a>`
			)
			.join(" ");
		const reason = entry.reason ? ` — ${escapeXml(entry.reason)}` : "";
		return `<li><strong>${escapeXml(entry.takeaway)}</strong>${reason} ${links}</li>`;
	});
	return `<ol>${lines.join("")}</ol>`;
}

// A stable id for one edition of the digest: it changes when the text does,
// so a reader sees a new entry only when there is a new digest.
async function digestGuid(topic: string, window: string, markdown: string) {
	const bytes = new TextEncoder().encode(markdown);
	const hash = await crypto.subtle.digest("SHA-256", bytes);
	const hex = [...new Uint8Array(hash).slice(0, 8)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
	return `opentrends:digest:${topic}:${window}:${hex}`;
}

function topicLink(topic: string, lang: string): string {
	const prefix = lang === "en" ? "" : `/${lang}`;
	return `${SITE_URL}${prefix}/feed?topic=${encodeURIComponent(topic)}`;
}

export const feedRoutes = new Hono()
	.get("/:topic/feed.xml", async (c) => {
		const topic = c.req.param("topic");
		const lang = normalizeTranslationLanguage(c.req.query("lang"));
		try {
			const page = await getTrendsPage(topic, lang);
			const xml = rssDocument(
				{
					description: page.description ?? `${page.title} · OpenTrends`,
					link: topicLink(topic, lang),
					title: `${page.title} · OpenTrends`,
				},
				latestItems(page).map(itemXml)
			);
			return c.body(xml, 200, {
				"Cache-Control": ITEM_FEED_CACHE,
				"Content-Type": "application/rss+xml; charset=utf-8",
			});
		} catch (error) {
			if (error instanceof TopicNotFoundError) {
				return c.json({ error: "topic_not_found", topic }, 404);
			}
			if (error instanceof TrendsSnapshotsUnavailableError) {
				return c.json({ error: "snapshots_unavailable" }, 503, {
					"Retry-After": "1",
				});
			}
			throw error;
		}
	})
	.get("/:topic/summary.xml", async (c) => {
		const topic = c.req.param("topic");
		const lang = normalizeTranslationLanguage(c.req.query("lang"));
		const window = normalizeSummaryWindow(c.req.query("window"));
		const channel = {
			description: `OpenTrends digest for ${topic} (${window})`,
			link: topicLink(topic, lang),
			title: `OpenTrends · ${topic} · ${window}`,
		};
		try {
			const prepared = await prepareTrendsSummary(topic, lang, { window });
			let markdown = "";
			for await (const chunk of prepared.stream(c.req.raw.signal)) {
				markdown += chunk;
			}
			const entries = parseDigestEntries(markdown, prepared.citations);
			const guid = await digestGuid(topic, window, markdown);
			const item = `<item>
<title>${escapeXml(`${channel.title} · ${new Date().toISOString().slice(0, 10)}`)}</title>
<link>${escapeXml(channel.link)}</link>
<guid isPermaLink="false">${escapeXml(guid)}</guid>
<description>${escapeXml(digestHtml(entries))}</description>
<pubDate>${rssDate(Date.now())}</pubDate>
</item>`;
			return c.body(rssDocument(channel, [item]), 200, {
				"Cache-Control": DIGEST_FEED_CACHE,
				"Content-Type": "application/rss+xml; charset=utf-8",
			});
		} catch (error) {
			if (error instanceof TopicNotFoundError) {
				return c.json({ error: "topic_not_found", topic }, 404);
			}
			if (
				error instanceof TrendsSummaryPendingError ||
				error instanceof TrendsSummaryNotConfiguredError ||
				error instanceof TrendsSnapshotsUnavailableError
			) {
				// Nothing to read yet; an empty channel keeps readers subscribed.
				return c.body(rssDocument(channel, []), 200, {
					"Cache-Control": "public, max-age=300",
					"Content-Type": "application/rss+xml; charset=utf-8",
				});
			}
			throw error;
		}
	});
