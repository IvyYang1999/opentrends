const CLOUDFLARE_FREE_SUBREQUEST_LIMIT = 50;

export const EVENT_CONTENT_ITEM_LIMIT = 4;
export const EVENT_CONTENT_REDIRECT_LIMIT = 2;
export const EVENT_EMBEDDING_ITEM_LIMIT = 32;
export const EVENT_ITEM_LIMIT = 120;
export const EVENT_EMBEDDING_PROVIDER_BATCH_SIZE = 8;
export const D1_EVENT_WRITE_BATCH_SIZE = 8;
export const D1_TOPIC_LINK_WRITE_BATCH_SIZE = 30;
export const D1_SOURCE_LINK_WRITE_BATCH_SIZE = 15;

const EVENT_TOPIC_READ_QUERY_COUNT = 2;
const EVENT_REBUILD_BASE_QUERY_COUNT = 2;
const EVENT_REBUILD_BASE_WRITE_COUNT = 5;
const QUEUE_CONTINUATION_SUBREQUEST_COUNT = 1;
const CONTENT_READ_QUERY_COUNT = 1;

function batches(itemCount: number, batchSize: number): number {
	return Math.ceil(Math.max(itemCount, 0) / batchSize);
}

export function estimateEmbeddingSubrequests(itemCount: number): number {
	return (
		EVENT_TOPIC_READ_QUERY_COUNT +
		batches(itemCount, EVENT_EMBEDDING_PROVIDER_BATCH_SIZE) +
		itemCount +
		QUEUE_CONTINUATION_SUBREQUEST_COUNT
	);
}

export function estimateContentEnrichmentSubrequests(
	itemCount: number,
	topicCount: number
): number {
	const fetchesPerItem = EVENT_CONTENT_REDIRECT_LIMIT + 1;
	return (
		CONTENT_READ_QUERY_COUNT +
		(fetchesPerItem + 1) * itemCount +
		topicCount +
		QUEUE_CONTINUATION_SUBREQUEST_COUNT
	);
}

export function takeEventContentBatch<T>(items: readonly T[]): {
	current: T[];
	remaining: T[];
} {
	return {
		current: items.slice(0, EVENT_CONTENT_ITEM_LIMIT),
		remaining: items.slice(EVENT_CONTENT_ITEM_LIMIT),
	};
}

export function estimateEventRebuildD1Queries(input: {
	eventCount: number;
	sourceLinkCount: number;
}): number {
	return (
		EVENT_REBUILD_BASE_QUERY_COUNT +
		EVENT_REBUILD_BASE_WRITE_COUNT +
		batches(input.eventCount, D1_EVENT_WRITE_BATCH_SIZE) +
		batches(input.eventCount, D1_TOPIC_LINK_WRITE_BATCH_SIZE) +
		batches(input.sourceLinkCount, D1_SOURCE_LINK_WRITE_BATCH_SIZE)
	);
}

if (
	estimateEmbeddingSubrequests(EVENT_EMBEDDING_ITEM_LIMIT) >=
	CLOUDFLARE_FREE_SUBREQUEST_LIMIT
) {
	throw new Error("Event embedding work exceeds the Cloudflare Free budget");
}

if (
	estimateEventRebuildD1Queries({
		eventCount: EVENT_ITEM_LIMIT,
		sourceLinkCount: EVENT_ITEM_LIMIT,
	}) > CLOUDFLARE_FREE_SUBREQUEST_LIMIT
) {
	throw new Error("Event replacement exceeds the Cloudflare Free budget");
}
