import { createHash } from "node:crypto";

import type { SourceId, TopicPreset } from "../types";
import { getSourcePreset } from "./sources";
import { getTopicPreset } from "./topics";

// A reader's followed sources behave like a topic of their own. The topic id
// is fixed; the source list travels with each request and is hashed into the
// cache keys, so two readers with the same list share one digest.
export const FOLLOWED_TOPIC_ID = "mine";
// Room for every source on the site, so a briefing can watch a keyword
// across all topics.
export const MAX_FOLLOWED_SOURCES = 320;
export const MAX_KEYWORDS = 10;
const MAX_KEYWORD_CHARS = 40;

export function parseFollowedSourceIds(value: string | undefined): SourceId[] {
	if (!value) {
		return [];
	}
	const seen = new Set<SourceId>();
	for (const raw of value.split(",")) {
		const sourceId = raw.trim();
		if (sourceId && getSourcePreset(sourceId)) {
			seen.add(sourceId);
		}
		if (seen.size >= MAX_FOLLOWED_SOURCES) {
			break;
		}
	}
	return [...seen];
}

// A briefing narrows its sources to items mentioning any of a few words.
export function parseKeywords(value: string | undefined): string[] {
	if (!value) {
		return [];
	}
	const seen = new Set<string>();
	for (const raw of value.split(",")) {
		const keyword = raw.trim().slice(0, MAX_KEYWORD_CHARS).toLowerCase();
		if (keyword) {
			seen.add(keyword);
		}
		if (seen.size >= MAX_KEYWORDS) {
			break;
		}
	}
	return [...seen];
}

export function followedSourcesKey(sourceIds: readonly SourceId[]): string {
	return createHash("sha1")
		.update([...sourceIds].sort().join("\n"))
		.digest("hex")
		.slice(0, 12);
}

export function followedTopicPreset(
	sourceIds: readonly SourceId[]
): TopicPreset {
	return {
		description: "Sources the reader follows",
		path: "/trends/mine",
		sections: [
			{ id: "followed", sourceIds: [...sourceIds], title: "Followed" },
		],
		title: "My sources",
	};
}

// Resolves a topic id, or the followed pseudo-topic when a source list is
// given. `cacheTopicId` is what caches are keyed by.
export function resolveTopic(
	topicId: string,
	sourceIds?: readonly SourceId[],
	keywords: readonly string[] = []
): { cacheTopicId: string; preset: TopicPreset } | undefined {
	if (topicId === FOLLOWED_TOPIC_ID) {
		if (!sourceIds || sourceIds.length === 0) {
			return;
		}
		const keywordKey =
			keywords.length > 0
				? `:kw:${followedSourcesKey([...keywords].sort())}`
				: "";
		return {
			cacheTopicId: `${FOLLOWED_TOPIC_ID}:${followedSourcesKey(sourceIds)}${keywordKey}`,
			preset: followedTopicPreset(sourceIds),
		};
	}
	const preset = getTopicPreset(topicId);
	return preset ? { cacheTopicId: topicId, preset } : undefined;
}
