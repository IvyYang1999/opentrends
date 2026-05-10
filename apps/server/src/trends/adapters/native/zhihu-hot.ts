import type { FetchContext, NewsItem, SourceAdapter } from "../../types";
import {
	clampItems,
	cleanDescription,
	fetchJson,
	isValidUrl,
	normalizeText,
} from "../shared";

const HOT_URL =
	"https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=50&desktop=true";

interface ZhihuChild {
	thumbnail?: string;
	type?: string;
	url?: string;
}

interface ZhihuFeed {
	data?: ZhihuFeedItem[];
}
interface ZhihuFeedItem {
	card_id?: string;
	children?: ZhihuChild[];
	detail_text?: string;
	target?: {
		excerpt?: string;
		id?: number | string;
		thumbnail?: string;
		title?: string;
		url?: string;
	};
}

function resolveImage(entry: ZhihuFeedItem): string | undefined {
	if (isValidUrl(entry.target?.thumbnail)) {
		return entry.target?.thumbnail;
	}
	for (const child of entry.children ?? []) {
		if (isValidUrl(child.thumbnail)) {
			return child.thumbnail;
		}
	}
	return;
}

export const zhihuHotAdapter: SourceAdapter = {
	async fetch(ctx: FetchContext): Promise<NewsItem[]> {
		const data = await fetchJson<ZhihuFeed>(HOT_URL, {
			signal: ctx.signal,
			headers: {
				Accept: "application/json, text/plain, */*",
			},
		});

		const fetchedAt = Date.now();
		const items: NewsItem[] = [];
		const list = data.data ?? [];

		for (let i = 0; i < list.length; i++) {
			const entry = list[i];
			const target = entry?.target;
			if (!target) {
				continue;
			}
			const id = target.id ?? entry.card_id;
			const title = normalizeText(target.title);
			const apiUrl = typeof target.url === "string" ? target.url : "";
			const url = apiUrl
				.replace(
					"https://api.zhihu.com/questions/",
					"https://www.zhihu.com/question/"
				)
				.replace(
					"http://api.zhihu.com/questions/",
					"https://www.zhihu.com/question/"
				);
			if (!(id && title && isValidUrl(url))) {
				continue;
			}
			items.push({
				id: `zhihu-${id}`,
				sourceId: ctx.sourceId,
				title,
				url,
				rank: i + 1,
				hotValue: normalizeText(entry.detail_text) || undefined,
				fetchedAt,
				description: cleanDescription(target.excerpt),
				imageUrl: resolveImage(entry),
			});
		}

		return clampItems(items);
	},
};
