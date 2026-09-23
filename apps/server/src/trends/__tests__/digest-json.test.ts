import { describe, expect, test } from "bun:test";

import { parseDigestEntries } from "../services/digest-json";

describe("parseDigestEntries", () => {
	test("turns the Markdown list into entries with resolved citations", () => {
		const entries = parseDigestEntries(
			"1. **GPT-6 ships** — everyone is testing it [1][3]\n2. Plain line [2]\n\nnot a list",
			[
				{ n: 1, topic: "ai", url: "https://a" },
				{ n: 2, url: "https://b" },
				{ n: 3, topic: "programming", url: "https://c" },
			]
		);
		expect(entries).toEqual([
			{
				citations: [
					{ n: 1, topic: "ai", url: "https://a" },
					{ n: 3, topic: "programming", url: "https://c" },
				],
				n: 1,
				reason: "everyone is testing it",
				takeaway: "GPT-6 ships",
			},
			{
				citations: [{ n: 2, url: "https://b" }],
				n: 2,
				reason: undefined,
				takeaway: "Plain line",
			},
		]);
	});
});

describe("filterCitedItems", () => {
	test("keeps items mentioning a keyword and renumbers them", async () => {
		const { filterCitedItems } = await import("../services/get-trends-summary");
		const item = (title: string, description?: string) =>
			({
				description,
				fetchedAt: 0,
				id: title,
				sourceId: "s",
				title,
				url: title,
			}) as never;
		const cited = [
			{ item: item("GPT-6 launches"), n: 1, source: "a" },
			{ item: item("Weather today"), n: 2, source: "a" },
			{
				item: item("Nothing here", "except gpt-6 in the summary"),
				n: 3,
				source: "b",
			},
		];
		expect(
			filterCitedItems(cited, ["gpt-6"]).map((e) => [e.n, e.item.title])
		).toEqual([
			[1, "GPT-6 launches"],
			[2, "Nothing here"],
		]);
		expect(filterCitedItems(cited, [])).toHaveLength(3);
	});
});
