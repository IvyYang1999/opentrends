import { describe, expect, test } from "bun:test";

import { prioritizeExpiredSourceIds } from "../services/source-refresh-priority";

describe("source refresh priority", () => {
	test("refreshes empty expired sources before populated ones", () => {
		const now = 10_000;
		expect(
			prioritizeExpiredSourceIds(
				[
					{
						sourceId: "hackernews",
						expiresAt: 1000,
						items: [{}],
					},
					{
						sourceId: "runway-news",
						expiresAt: 9000,
						items: [],
					},
					{
						sourceId: "openrouter-announcements",
						expiresAt: 8000,
						items: [],
					},
				],
				now
			)
		).toEqual(["openrouter-announcements", "runway-news", "hackernews"]);
	});

	test("ignores fresh sources and deduplicates repeated cards", () => {
		const source = {
			sourceId: "runway-news" as const,
			expiresAt: 9000,
			items: [],
		};
		expect(
			prioritizeExpiredSourceIds(
				[
					source,
					source,
					{
						sourceId: "hackernews",
						expiresAt: 11_000,
						items: [{}],
					},
				],
				10_000
			)
		).toEqual(["runway-news"]);
	});
});
