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
