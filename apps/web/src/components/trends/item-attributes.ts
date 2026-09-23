import { type ContentKind, contentKind } from "./content-kind";
import { isChineseText } from "./reader-context";
import { coverKind } from "./source-card-model";
import type { NewsItem, SourceCardData } from "./types";

// The handful of things that distinguish one card from another to a reader
// who has not read it yet: whether it has a picture, how new it is, whether
// it is hot on its source, what language it was written in, and what sort
// of place it came from. Each item is described by a small set of these
// tags; clicks are recorded with them, and the feed compares what a reader
// clicks against what it shows.
export type ItemAttribute =
	| "cover"
	| "text"
	| "fresh"
	| "hot"
	| "lang:zh"
	| "lang:other"
	| "genre:community"
	| "genre:makers"
	| "genre:research"
	| "genre:official"
	| "genre:news"
	| "genre:ranking"
	| `kind:${ContentKind}`;

const HOUR_MS = 60 * 60 * 1000;
const FRESH_MS = 6 * HOUR_MS;
const COMMUNITY_RE =
	/reddit|hackernews|^hn-|v2ex|lobsters|zhihu|weibo|juejin|tieba|douban/;
const MAKERS_RE = /github|producthunt|kickstarter|crowd-supply|indie|hackaday/;
const RESEARCH_RE =
	/arxiv|nature|science|biorxiv|medrxiv|cell|lancet|nejm|research|paper|-lab\b|transformer-circuits/;
const OFFICIAL_RE =
	/blog|changelog|updates|news$|announce|release|-ai$|openai|anthropic|google|meta|nvidia|apple|microsoft|qwen|deepseek|kimi|minimax|bytedance|tencent|alibaba|baidu/;

// Where an item came from, read off the source id. A heuristic, so the
// patterns favour recall for community and research, where the reading
// experience differs most; anything else that is not a company channel is
// news.
export function sourceGenre(source: SourceCardData): ItemAttribute {
	if (source.kind === "ranking") {
		return "genre:ranking";
	}
	const id = source.sourceId.toLowerCase();
	if (COMMUNITY_RE.test(id)) {
		return "genre:community";
	}
	if (MAKERS_RE.test(id)) {
		return "genre:makers";
	}
	if (RESEARCH_RE.test(id)) {
		return "genre:research";
	}
	if (OFFICIAL_RE.test(id)) {
		return "genre:official";
	}
	return "genre:news";
}

export function itemAttributes(
	item: NewsItem,
	source: SourceCardData,
	options: { hot?: boolean; now: number }
): ItemAttribute[] {
	const attributes: ItemAttribute[] = [
		coverKind(item.imageUrl) === "cover" ? "cover" : "text",
		isChineseText(item.original?.title ?? item.title)
			? "lang:zh"
			: "lang:other",
		sourceGenre(source),
	];
	if (item.publishedAt && options.now - item.publishedAt < FRESH_MS) {
		attributes.push("fresh");
	}
	if (options.hot) {
		attributes.push("hot");
	}
	const kind = contentKind(item);
	if (kind) {
		attributes.push(`kind:${kind}`);
	}
	return attributes;
}
