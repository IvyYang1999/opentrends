import type { FetchContext, NewsItem, SourceAdapter } from "../../types";
import {
	clampItems,
	cleanDescription,
	fetchJson,
	isValidUrl,
	normalizeText,
} from "../shared";

const HOT_URL =
	"https://api.juejin.cn/content_api/v1/content/article_rank?category_id=1&type=hot";

interface JuejinHotResponse {
	data?: JuejinHotEntry[];
}

interface JuejinHotEntry {
	content?: {
		brief_content?: string;
		content_id?: string;
		cover_image?: string;
		pic?: string;
		screenshot?: string;
		title?: string;
	};
	content_counter?: {
		hot_rank?: number;
		like?: number;
	};
}

function resolveCover(entry: JuejinHotEntry): string | undefined {
	const candidates = [
		entry.content?.cover_image,
		entry.content?.pic,
		entry.content?.screenshot,
	];
	for (const candidate of candidates) {
		if (isValidUrl(candidate)) {
			return candidate;
		}
	}
	return;
}

export const juejinHotAdapter: SourceAdapter = {
	async fetch(ctx: FetchContext): Promise<NewsItem[]> {
		const data = await fetchJson<JuejinHotResponse>(HOT_URL, {
			signal: ctx.signal,
		});
		const fetchedAt = Date.now();
		const items: NewsItem[] = [];
		const list = data.data ?? [];

		for (let i = 0; i < list.length; i++) {
			const entry = list[i];
			const id = entry?.content?.content_id;
			const title = normalizeText(entry?.content?.title);
			if (!(id && title)) {
				continue;
			}
			const url = `https://juejin.cn/post/${id}`;
			items.push({
				id: `juejin-${id}`,
				sourceId: ctx.sourceId,
				title,
				url,
				rank: i + 1,
				hotValue:
					entry?.content_counter?.hot_rank ?? entry?.content_counter?.like,
				fetchedAt,
				description: cleanDescription(entry?.content?.brief_content),
				imageUrl: resolveCover(entry),
			});
		}

		return clampItems(items);
	},
};
