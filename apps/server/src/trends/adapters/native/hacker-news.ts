import type { FetchContext, NewsItem, SourceAdapter } from "../../types";
import {
	clampItems,
	cleanDescription,
	fetchJson,
	isValidUrl,
	normalizeText,
} from "../shared";

interface HnItem {
	id: number;
	score?: number;
	text?: string;
	time?: number;
	title?: string;
	type?: string;
	url?: string;
}

const ITEM_URL = (id: number) =>
	`https://hacker-news.firebaseio.com/v0/item/${id}.json`;
const FETCH_LIMIT = 40;

const ENDPOINTS = {
	top: "https://hacker-news.firebaseio.com/v0/topstories.json",
	best: "https://hacker-news.firebaseio.com/v0/beststories.json",
	new: "https://hacker-news.firebaseio.com/v0/newstories.json",
	show: "https://hacker-news.firebaseio.com/v0/showstories.json",
	ask: "https://hacker-news.firebaseio.com/v0/askstories.json",
} as const;

type HnEndpoint = keyof typeof ENDPOINTS;

function resolveEndpointUrl(params: FetchContext["params"]): string {
	const raw = params?.endpoint;
	if (typeof raw === "string" && raw in ENDPOINTS) {
		return ENDPOINTS[raw as HnEndpoint];
	}
	return ENDPOINTS.top;
}

export const hackerNewsAdapter: SourceAdapter = {
	async fetch(ctx: FetchContext): Promise<NewsItem[]> {
		const ids = await fetchJson<number[]>(resolveEndpointUrl(ctx.params), {
			signal: ctx.signal,
		});
		const slice = ids.slice(0, FETCH_LIMIT);

		const settled = await Promise.allSettled(
			slice.map((id) => fetchJson<HnItem>(ITEM_URL(id), { signal: ctx.signal }))
		);

		const fetchedAt = Date.now();
		const items: NewsItem[] = [];
		for (let i = 0; i < settled.length; i++) {
			const result = settled[i];
			if (!result || result.status !== "fulfilled") {
				continue;
			}
			const hn = result.value;
			if (!hn || hn.type !== "story") {
				continue;
			}
			const title = normalizeText(hn.title);
			const url = hn.url ?? `https://news.ycombinator.com/item?id=${hn.id}`;
			if (!(title && isValidUrl(url))) {
				continue;
			}
			const description = cleanDescription(hn.text);
			items.push({
				id: `hn-${hn.id}`,
				sourceId: ctx.sourceId,
				title,
				url,
				rank: i + 1,
				hotValue: hn.score,
				publishedAt: hn.time ? hn.time * 1000 : undefined,
				fetchedAt,
				description,
			});
		}

		return clampItems(items);
	},
};
