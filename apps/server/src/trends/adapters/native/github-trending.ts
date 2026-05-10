import { load } from "cheerio";

import type { FetchContext, NewsItem, SourceAdapter } from "../../types";
import { clampItems, fetchText, isValidUrl, normalizeText } from "../shared";

const SINCE_VALUES = new Set(["daily", "weekly", "monthly"]);

function buildTrendingUrl(params: FetchContext["params"]): string {
	const search = new URLSearchParams();
	const since = params?.since;
	if (typeof since === "string" && SINCE_VALUES.has(since)) {
		search.set("since", since);
	}
	const language = params?.language;
	if (typeof language === "string" && language) {
		search.set("language", language);
	}
	const query = search.toString();
	return query
		? `https://github.com/trending?${query}`
		: "https://github.com/trending";
}

const COMMA_WHITESPACE_RE = /[,\s]/g;
const STAR_COUNT_RE = /(\d+(?:\.\d+)?)([km]?)/i;

function parseStars(text: string | undefined): number | undefined {
	if (!text) {
		return;
	}
	const cleaned = text.replace(COMMA_WHITESPACE_RE, "");
	const match = cleaned.match(STAR_COUNT_RE);
	if (!match) {
		return;
	}
	const base = Number(match[1]);
	const suffix = match[2]?.toLowerCase();
	if (suffix === "k") {
		return Math.round(base * 1000);
	}
	if (suffix === "m") {
		return Math.round(base * 1_000_000);
	}
	return Math.round(base);
}

const SLUG_OWNER_RE = /^([^/\s]+)\s*\/\s*[^/\s]+$/;

function ownerAvatarUrl(slug: string): string | undefined {
	const owner = SLUG_OWNER_RE.exec(slug)?.[1];
	if (!owner) {
		return;
	}
	return `https://github.com/${encodeURIComponent(owner)}.png?size=96`;
}

export const githubTrendingAdapter: SourceAdapter = {
	async fetch(ctx: FetchContext): Promise<NewsItem[]> {
		const html = await fetchText(buildTrendingUrl(ctx.params), {
			signal: ctx.signal,
		});
		const $ = load(html);
		const fetchedAt = Date.now();
		const items: NewsItem[] = [];

		let rank = 0;
		$("article.Box-row").each((_, article) => {
			const $a = $(article).find("h2 a").first();
			const href = $a.attr("href");
			if (!href) {
				return;
			}
			const url = `https://github.com${href.trim()}`;
			if (!isValidUrl(url)) {
				return;
			}
			const slug = normalizeText($a.text());
			if (!slug) {
				return;
			}

			rank += 1;
			// `<p>` directly inside the article carries the repo description.
			// Class names drift (e.g. `pr-4` → `tmp-pr-4`), so we don't anchor
			// on them — the first child <p> is reliably the description.
			const desc = normalizeText($(article).children("p").first().text());
			const starsText = $(article)
				.find(`a[href$="${href}/stargazers"]`)
				.first()
				.text();
			const stars = parseStars(starsText);

			items.push({
				id: `gh-${slug}`,
				sourceId: ctx.sourceId,
				title: slug,
				url,
				rank,
				hotValue: stars,
				fetchedAt,
				description: desc || undefined,
				imageUrl: ownerAvatarUrl(slug),
			});
		});

		return clampItems(items);
	},
};
