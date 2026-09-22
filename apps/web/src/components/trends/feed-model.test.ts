import { describe, expect, test } from "bun:test";

import { interleaveSources, rankFeed } from "./feed-model";
import type { NewsItem, SourceCardData, TrendsPageData } from "./types";

const NOW = Date.UTC(2026, 8, 22, 12);

function source(id: string, items: Partial<NewsItem>[]): SourceCardData {
	return {
		homeUrl: `https://${id}.example.com`,
		items: items.map((item, index) => ({
			fetchedAt: NOW,
			id: `${id}-${index}`,
			sourceId: id,
			title: `${id} ${index}`,
			url: `https://${id}.example.com/${index}`,
			...item,
		})),
		sourceId: id,
		status: "ok",
		title: id,
	};
}

function page(sources: SourceCardData[]): TrendsPageData {
	return {
		description: "",
		id: "ai",
		sections: [{ id: "s", sources, title: "s" }],
		title: "AI",
		updatedAt: NOW,
	} as unknown as TrendsPageData;
}

describe("rankFeed", () => {
	test("fresh beats stale, heat and following break ties", () => {
		const feed = rankFeed(
			[
				page([
					source("old", [{ publishedAt: NOW - 3 * 24 * 60 * 60 * 1000 }]),
					source("fresh", [{ publishedAt: NOW - 60 * 60 * 1000 }]),
					source("hot", [
						{ hotValue: 900, publishedAt: NOW - 60 * 60 * 1000 },
						{ hotValue: 5, publishedAt: NOW - 60 * 60 * 1000 },
					]),
				]),
			],
			["fresh"],
			NOW
		);
		const order = feed.map((entry) => entry.item.id);
		expect(order[0]).toBe("fresh-0");
		expect(order.indexOf("hot-0")).toBeLessThan(order.indexOf("hot-1"));
		expect(order.indexOf("old-0")).toBeGreaterThan(order.indexOf("hot-0"));
	});

	test("reads Chinese heat suffixes", () => {
		const feed = rankFeed(
			[page([source("w", [{ hotValue: "248.1万热度" }, { hotValue: "12" }])])],
			[],
			NOW
		);
		expect(feed[0]?.heat).toBe(2_481_000);
	});
});

describe("interleaveSources", () => {
	test("does not place two entries from one source next to each other when avoidable", () => {
		const a = source("a", [{}, {}, {}]);
		const b = source("b", [{}]);
		const entries = [
			...a.items.map((item) => ({ item, score: 1, source: a })),
			...b.items.map((item) => ({ item, score: 0.5, source: b })),
		];
		expect(interleaveSources(entries).map((e) => e.source.sourceId)).toEqual([
			"a",
			"b",
			"a",
			"a",
		]);
	});
});
