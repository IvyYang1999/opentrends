import { fieldsMatchAnyKeyword } from "@opentrends/api/keyword-match";

// A briefing is a reader's own digest: some sources (usually a whole topic
// or two), a few keywords to narrow them, and the hour they would like it.
// Kept in the browser like the follow list; nothing about it is inferred.
export interface Briefing {
	createdAt: number;
	hour: number;
	id: string;
	keywords: string[];
	name: string;
	sourceIds: string[];
	/** Set once the reader asked for it by mail; doubles as the unsubscribe token. */
	subscriptionId?: string;
	topicIds: string[];
}

export interface TopicSummary {
	description?: string;
	id: string;
	sourceIds: string[];
	title: string;
}

export const STORAGE_KEY = "opentrends:briefings:v1";
export const MAX_KEYWORDS = 10;
export const DEFAULT_HOUR = 8;
const KEYWORD_SPLIT_RE = /[,，;；\n]+/;

export function parseKeywordInput(value: string): string[] {
	const seen = new Set<string>();
	for (const raw of value.split(KEYWORD_SPLIT_RE)) {
		const keyword = raw.trim();
		if (keyword) {
			seen.add(keyword);
		}
		if (seen.size >= MAX_KEYWORDS) {
			break;
		}
	}
	return [...seen];
}

// The union of the chosen topics' sources, in topic order, each once.
export function sourcesForTopics(
	topicIds: readonly string[],
	topics: readonly TopicSummary[]
): string[] {
	const byId = new Map(topics.map((topic) => [topic.id, topic]));
	const seen = new Set<string>();
	for (const topicId of topicIds) {
		for (const sourceId of byId.get(topicId)?.sourceIds ?? []) {
			seen.add(sourceId);
		}
	}
	return [...seen];
}

export function newBriefingId(): string {
	return `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function readBriefings(storage: Pick<Storage, "getItem">): Briefing[] {
	try {
		const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]");
		if (!Array.isArray(parsed)) {
			return [];
		}
		return parsed.filter(
			(entry): entry is Briefing =>
				typeof entry === "object" &&
				entry !== null &&
				typeof (entry as Briefing).id === "string" &&
				Array.isArray((entry as Briefing).sourceIds)
		);
	} catch {
		return [];
	}
}

// Items of the followed page that mention any keyword, newest first; with
// no keywords, everything, so the list under the digest is never empty.
export function matchingItems<
	T extends {
		description?: string;
		fetchedAt: number;
		original?: { title: string };
		publishedAt?: number;
		title: string;
	},
>(items: readonly T[], keywords: readonly string[]): T[] {
	const kept =
		keywords.length === 0
			? [...items]
			: items.filter((item) =>
					fieldsMatchAnyKeyword(
						[item.title, item.original?.title, item.description],
						keywords
					)
				);
	kept.sort(
		(a, b) => (b.publishedAt ?? b.fetchedAt) - (a.publishedAt ?? a.fetchedAt)
	);
	return kept;
}
