import { describe, expect, it } from "bun:test";

import {
	EVENT_CONTENT_ITEM_LIMIT,
	EVENT_EMBEDDING_ITEM_LIMIT,
	EVENT_ITEM_LIMIT,
	estimateContentEnrichmentSubrequests,
	estimateEmbeddingSubrequests,
	estimateEventRebuildD1Queries,
	takeEventContentBatch,
} from "../services/event-work-budget";

describe("Cloudflare Free event-work budget", () => {
	it("keeps one content-enrichment task below 50 subrequests", () => {
		expect(
			estimateContentEnrichmentSubrequests(EVENT_CONTENT_ITEM_LIMIT, 7)
		).toBeLessThan(50);
	});

	it("continues oversized content work without duplicating the current batch", () => {
		const input = Array.from(
			{ length: EVENT_CONTENT_ITEM_LIMIT * 2 + 1 },
			(_, index) => index
		);
		const result = takeEventContentBatch(input);

		expect(result.current).toEqual(input.slice(0, EVENT_CONTENT_ITEM_LIMIT));
		expect(result.remaining).toEqual(input.slice(EVENT_CONTENT_ITEM_LIMIT));
	});

	it("keeps one embedding continuation below 50 subrequests", () => {
		expect(
			estimateEmbeddingSubrequests(EVENT_EMBEDDING_ITEM_LIMIT)
		).toBeLessThan(50);
	});

	it("keeps the worst-case event replacement within 50 D1 queries", () => {
		expect(
			estimateEventRebuildD1Queries({
				eventCount: EVENT_ITEM_LIMIT,
				sourceLinkCount: EVENT_ITEM_LIMIT,
			})
		).toBeLessThanOrEqual(50);
	});
});
