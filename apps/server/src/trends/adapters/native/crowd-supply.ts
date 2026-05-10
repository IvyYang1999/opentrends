import { load } from "cheerio";

import type { FetchContext, NewsItem, SourceAdapter } from "../../types";
import {
	clampItems,
	cleanDescription,
	fetchText,
	isValidUrl,
	normalizeText,
} from "../shared";

const HOME_URL = "https://www.crowdsupply.com/";
const ORIGIN = "https://www.crowdsupply.com";

const FUNDED_RE = /(\d+)\s*%\s*Funded/i;

function resolveAbsolute(src: string | undefined): string | undefined {
	if (!src) {
		return;
	}
	const absolute = src.startsWith("http") ? src : `${ORIGIN}${src}`;
	return isValidUrl(absolute) ? absolute : undefined;
}

export const crowdSupplyAdapter: SourceAdapter = {
	async fetch(ctx: FetchContext): Promise<NewsItem[]> {
		const html = await fetchText(HOME_URL, { signal: ctx.signal });
		const $ = load(html);
		const fetchedAt = Date.now();
		const seen = new Set<string>();
		const items: NewsItem[] = [];

		let rank = 0;
		$("a.project-tile").each((_, el) => {
			const $el = $(el);
			const href = $el.attr("href");
			const title = normalizeText($el.attr("aria-label"));
			if (!(href && title)) {
				return;
			}
			if (seen.has(href)) {
				return;
			}
			seen.add(href);

			const url = resolveAbsolute(href);
			if (!url) {
				return;
			}

			rank += 1;
			const description = cleanDescription(
				$el.find(".project-tile-overview p").first().text()
			);
			const fundedText = $el.text();
			const fundedMatch = FUNDED_RE.exec(fundedText);
			const fundedPercent = fundedMatch?.[1]
				? Number(fundedMatch[1])
				: undefined;
			const imageUrl = resolveAbsolute($el.find("img").first().attr("src"));

			items.push({
				id: `crowdsupply-${href}`,
				sourceId: ctx.sourceId,
				title,
				url,
				rank,
				hotValue: Number.isFinite(fundedPercent) ? fundedPercent : undefined,
				fetchedAt,
				description,
				imageUrl,
			});
		});

		return clampItems(items);
	},
};
