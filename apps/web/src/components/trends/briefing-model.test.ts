import { describe, expect, test } from "bun:test";

import {
	matchingItems,
	parseKeywordInput,
	readBriefings,
	sourcesForTopics,
} from "./briefing-model";

describe("briefing model", () => {
	test("parses keywords from any separator, deduplicated and capped", () => {
		expect(parseKeywordInput("GPT-6, 具身智能；Rust\n gpt-6 ")).toEqual([
			"GPT-6",
			"具身智能",
			"Rust",
			"gpt-6",
		]);
		expect(
			parseKeywordInput(Array.from({ length: 20 }, (_, i) => `k${i}`).join(","))
		).toHaveLength(10);
	});

	test("unions topic sources in order", () => {
		const topics = [
			{ id: "ai", sourceIds: ["a", "b"], title: "AI" },
			{ id: "cn", sourceIds: ["b", "c"], title: "CN" },
		];
		expect(sourcesForTopics(["cn", "ai"], topics)).toEqual(["b", "c", "a"]);
	});

	test("reads only well-formed briefings", () => {
		const storage = {
			getItem: () =>
				JSON.stringify([{ id: "x", sourceIds: ["a"] }, { nope: true }, 3]),
		};
		expect(readBriefings(storage)).toHaveLength(1);
		expect(readBriefings({ getItem: () => "{" })).toEqual([]);
	});

	test("matches items on any field, newest first", () => {
		const items = [
			{ fetchedAt: 1, publishedAt: 10, title: "old gpt-6 news" },
			{
				fetchedAt: 2,
				publishedAt: 20,
				title: "unrelated",
				description: "mentions GPT-6",
			},
			{ fetchedAt: 3, publishedAt: 30, title: "nothing" },
		];
		expect(matchingItems(items, ["gpt-6"]).map((i) => i.publishedAt)).toEqual([
			20, 10,
		]);
		expect(matchingItems(items, [])).toHaveLength(3);
	});
});
