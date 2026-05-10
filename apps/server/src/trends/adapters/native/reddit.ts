import type { FetchContext, NewsItem, SourceAdapter } from "../../types";
import {
	clampItems,
	cleanDescription,
	fetchJson,
	isValidUrl,
	normalizeText,
} from "../shared";

interface RedditListing {
	data?: {
		children?: Array<{ data?: RedditChild }>;
	};
}

interface RedditPreviewImage {
	source?: { url?: string };
}

interface RedditChild {
	created_utc?: number;
	id?: string;
	is_self?: boolean;
	num_comments?: number;
	permalink?: string;
	preview?: { images?: RedditPreviewImage[] };
	score?: number;
	selftext?: string;
	stickied?: boolean;
	thumbnail?: string;
	title?: string;
	url?: string;
}

// Reddit uses these magic strings in `thumbnail` when the post has no
// real preview image. Treat them as "no image" so we don't render the
// crossed-out placeholder.
const NON_IMAGE_THUMBNAILS = new Set([
	"self",
	"default",
	"nsfw",
	"spoiler",
	"image",
	"",
]);

function resolveImage(post: RedditChild): string | undefined {
	const previewUrl = post.preview?.images?.[0]?.source?.url;
	if (isValidUrl(previewUrl)) {
		return previewUrl;
	}
	const thumb = post.thumbnail;
	if (thumb && !NON_IMAGE_THUMBNAILS.has(thumb) && isValidUrl(thumb)) {
		return thumb;
	}
	return;
}

const DEFAULT_LIMIT = 50;

function resolveLink(post: RedditChild): string | undefined {
	const externalUrl = post.url;
	const permalink = post.permalink
		? `https://www.reddit.com${post.permalink}`
		: undefined;
	if (externalUrl && !post.is_self && isValidUrl(externalUrl)) {
		return externalUrl;
	}
	return permalink;
}

function toNewsItem(
	post: RedditChild,
	rank: number,
	subreddit: string,
	sourceId: string,
	fetchedAt: number
): NewsItem | undefined {
	const title = normalizeText(post.title);
	const link = resolveLink(post);
	if (!(title && isValidUrl(link))) {
		return;
	}
	return {
		id: post.id ? `reddit-${subreddit}-${post.id}` : link,
		sourceId,
		title,
		url: link,
		rank,
		hotValue: post.score,
		publishedAt: post.created_utc
			? Math.round(post.created_utc * 1000)
			: undefined,
		fetchedAt,
		description: cleanDescription(post.selftext),
		imageUrl: resolveImage(post),
	};
}

export const redditAdapter: SourceAdapter = {
	async fetch(ctx: FetchContext): Promise<NewsItem[]> {
		const subreddit = String(ctx.params?.subreddit ?? "").trim();
		if (!subreddit) {
			throw new Error("reddit adapter requires params.subreddit");
		}
		const sort = String(ctx.params?.sort ?? "hot");
		const limit = Number(ctx.params?.limit ?? DEFAULT_LIMIT);
		const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/${sort}.json?limit=${limit}&raw_json=1`;

		const data = await fetchJson<RedditListing>(url, { signal: ctx.signal });
		const fetchedAt = Date.now();
		const items: NewsItem[] = [];
		const list = data.data?.children ?? [];

		let rank = 0;
		for (const child of list) {
			const post = child.data;
			if (!post || post.stickied) {
				continue;
			}
			rank += 1;
			const item = toNewsItem(post, rank, subreddit, ctx.sourceId, fetchedAt);
			if (item) {
				items.push(item);
			}
		}

		return clampItems(items);
	},
};
