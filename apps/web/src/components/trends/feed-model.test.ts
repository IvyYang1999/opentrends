import { describe, expect, test } from "bun:test";

import { arrangeFeed, rankFeed, withListCards } from "./feed-model";
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

describe("arrangeFeed", () => {
	test("gives seven of ten slots to illustrated items and caps a source per window", () => {
		const a = source(
			"a",
			Array.from({ length: 20 }, () => ({ imageUrl: "https://img" }))
		);
		const b = source(
			"b",
			Array.from({ length: 20 }, () => ({}))
		);
		const c = source(
			"c",
			Array.from({ length: 20 }, () => ({ imageUrl: "https://img" }))
		);
		const bySource = { a, b, c } as const;
		const entries = [...a.items, ...c.items, ...b.items].map((item) => ({
			heat: undefined,
			item,
			kind: "item" as const,
			score: 1,
			source: bySource[item.sourceId as keyof typeof bySource],
		}));
		const arranged = arrangeFeed(entries);
		const firstTen = arranged.slice(0, 10);
		expect(firstTen.filter((e) => e.item.imageUrl).length).toBe(7);
		for (let i = 0; i + 12 <= arranged.length; i += 1) {
			const window = arranged.slice(i, i + 12).map((e) => e.source.sourceId);
			for (const id of ["a", "b", "c"]) {
				expect(window.filter((x) => x === id).length).toBeLessThanOrEqual(12);
			}
		}
		expect(arranged).toHaveLength(60);
	});
});

describe("withListCards", () => {
	test("slips a ranking card in after every seventh story", () => {
		const s = source(
			"s",
			Array.from({ length: 23 }, () => ({}))
		);
		const entries = s.items.map((item) => ({
			heat: undefined,
			item,
			kind: "item" as const,
			score: 1,
			source: s,
		}));
		const blocks = withListCards(entries, [
			source("r1", [{}]),
			source("r2", [{}]),
		]);
		expect(blocks.map((b) => b.kind).filter((k) => k === "list")).toHaveLength(
			2
		);
		expect(blocks[7]?.kind).toBe("list");
	});
});
