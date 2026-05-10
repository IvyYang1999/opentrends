import type { FetchContext, NewsItem, SourceAdapter } from "../../types";
import { clampItems, fetchJson, normalizeText } from "../shared";

const LIST_URL =
	"https://qwen.ai/api/v2/article/retrieval?type=qwen_ai&language=en-US";
const ARTICLE_URL = (path: string) => `https://qwen.ai/research/${path}`;

interface QwenArticle {
	extra?: {
		date?: string;
	};
	id?: string;
	path?: string;
	title?: string;
}

interface QwenRetrievalResponse {
	data?: {
		articles?: QwenArticle[];
	};
}

export const qwenResearchAdapter: SourceAdapter = {
	async fetch(ctx: FetchContext): Promise<NewsItem[]> {
		const response = await fetchJson<QwenRetrievalResponse>(LIST_URL, {
			signal: ctx.signal,
		});
		const articles = response.data?.articles ?? [];
		const fetchedAt = Date.now();

		const sorted = [...articles].sort((a, b) => {
			const ta = a.extra?.date ? Date.parse(a.extra.date) : 0;
			const tb = b.extra?.date ? Date.parse(b.extra.date) : 0;
			return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
		});

		const items: NewsItem[] = [];
		for (let i = 0; i < sorted.length; i++) {
			const entry = sorted[i];
			const path = entry?.path;
			const title = normalizeText(entry?.title);
			if (!(path && title)) {
				continue;
			}
			const dateStr = entry.extra?.date;
			const published = dateStr ? Date.parse(dateStr) : Number.NaN;
			items.push({
				id: `qwen-research-${path}`,
				sourceId: ctx.sourceId,
				title,
				url: ARTICLE_URL(path),
				rank: i + 1,
				publishedAt: Number.isFinite(published) ? published : undefined,
				fetchedAt,
			});
		}

		return clampItems(items);
	},
};
