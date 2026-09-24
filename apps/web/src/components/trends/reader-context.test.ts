import { describe, expect, test } from "bun:test";

import { rankFeed } from "./feed-model";
import {
	affinitiesFromSignals,
	buildReaderContext,
	NEUTRAL_READER,
	termOverlap,
	titleTerms,
} from "./reader-context";
import type { NewsItem, SourceCardData, TrendsPageData } from "./types";

const NOW = Date.UTC(2026, 8, 22, 12);
const HOUR = 60 * 60 * 1000;

function source(id: string, items: Partial<NewsItem>[]): SourceCardData {
	return {
		homeUrl: `https://${id}.example.com`,
		items: items.map((item, index) => ({
			fetchedAt: NOW,
			id: `${id}-${index}`,
			publishedAt: NOW - HOUR,
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

describe("titleTerms", () => {
	test("keeps Latin words and Chinese bigrams, drops stop words", () => {
		expect(titleTerms("How the new GPT-6 model works")).toEqual([
			"gpt-6",
			"model",
			"works",
		]);
		expect(titleTerms("具身智能")).toEqual(["具身", "身智", "智能"]);
	});
});

describe("affinitiesFromSignals", () => {
	test("recent clicks weigh more and saturate", () => {
		const { sourceAffinity, termAffinity } = affinitiesFromSignals(
			[
				...Array.from({ length: 5 }, () => ({
					at: NOW,
					kind: "click" as const,
					sourceId: "hn",
					title: "Rust compiler speedup",
					url: "u",
				})),
				{
					at: NOW - 7 * 24 * HOUR,
					kind: "click",
					sourceId: "old",
					title: "Old story",
					url: "v",
				},
			],
			NOW
		);
		expect(sourceAffinity.get("hn")).toBe(1);
		expect(sourceAffinity.get("old")).toBeCloseTo(0.1, 5);
		expect(termAffinity.get("rust")).toBe(1);
		expect(termOverlap("Rust 1.90 released", termAffinity)).toBe(1);
		expect(termOverlap("Nothing related", termAffinity)).toBe(0);
	});
});

describe("rankFeed with a reader", () => {
	test("prefers the reader's own language and clicked sources", () => {
		const pages = [
			page([
				source("en-blog", [{ title: "A model update" }]),
				source("cn-blog", [{ title: "模型更新" }]),
			]),
		];
		const neutral = rankFeed(pages, [], NOW, NEUTRAL_READER).map(
			(entry) => entry.item.id
		);
		expect(neutral[0]).toBe("en-blog-0");

		const zhReader = buildReaderContext({
			locale: "zh",
			now: NOW,
			signals: [],
			timeZone: "Asia/Shanghai",
		});
		expect(zhReader.sinosphere).toBe(true);
		const zh = rankFeed(pages, [], NOW, zhReader).map((entry) => entry.item.id);
		expect(zh[0]).toBe("cn-blog-0");

		const clicker = buildReaderContext({
			locale: "zh",
			now: NOW,
			signals: Array.from({ length: 5 }, () => ({
				at: NOW,
				kind: "click" as const,
				sourceId: "en-blog",
				title: "model",
				url: "u",
			})),
			timeZone: "Asia/Shanghai",
		});
		const clicked = rankFeed(pages, [], NOW, clicker).map(
			(entry) => entry.item.id
		);
		expect(clicked[0]).toBe("en-blog-0");
	});

	test("in the morning, overnight stories keep their place", () => {
		const pages = [
			page([
				source("night", [{ publishedAt: NOW - 9 * HOUR, hotValue: 400 }]),
				source("now", [{ publishedAt: NOW - HOUR, hotValue: 1 }]),
			]),
		];
		const noon = rankFeed(pages, [], NOW, { ...NEUTRAL_READER, hour: 12 });
		const morning = rankFeed(pages, [], NOW, { ...NEUTRAL_READER, hour: 7 });
		const gapAtNoon = (noon[0]?.score ?? 0) / (noon[1]?.score ?? 1);
		const gapInMorning = (morning[0]?.score ?? 0) / (morning[1]?.score ?? 1);
		expect(gapInMorning).toBeLessThan(gapAtNoon);
	});
});

describe("attribute taste", () => {
	test("a reader who only clicks pictures gets pictures first", () => {
		const pages = [
			page([
				source("pics", [
					{ imageUrl: "https://img/1.jpg", title: "one" },
					{ imageUrl: "https://img/2.jpg", title: "two" },
				]),
				source("words", [{ title: "three" }, { title: "four" }]),
			]),
		];
		const clicks = Array.from({ length: 6 }, () => ({
			at: NOW,
			attributes: ["cover", "lang:other", "genre:news"],
			kind: "click" as const,
			sourceId: "elsewhere",
			title: "x",
			url: "u",
		}));
		const reader = buildReaderContext({
			locale: "en",
			now: NOW,
			signals: clicks,
		});
		expect(reader.attributeShare.get("cover")).toBe(1);
		const feed = rankFeed(pages, [], NOW, reader);
		expect(feed[0]?.attributes).toContain("cover");
		const pictureScore =
			feed.find((e) => e.source.sourceId === "pics")?.score ?? 0;
		const wordScore =
			feed.find((e) => e.source.sourceId === "words")?.score ?? 0;
		expect(pictureScore / wordScore).toBeGreaterThan(1.3);
	});

	test("fewer than five clicks change nothing", () => {
		const reader = buildReaderContext({
			locale: "en",
			now: NOW,
			signals: [
				{
					at: NOW,
					attributes: ["cover"],
					kind: "click",
					sourceId: "s",
					title: "x",
					url: "u",
				},
			],
		});
		expect(reader.attributeShare.size).toBe(0);
	});
});
